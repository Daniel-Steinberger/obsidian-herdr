import {
  App,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  normalizePath,
  setIcon,
  setTooltip,
} from "obsidian";
import { HerdrClient, WorkspaceView, defaultSocketPath } from "./herdr-client";
import { nextOpen, parseTodos, withContext } from "./todos";
import { resolveWorkspace } from "./mapping";
import { CompletionTracker } from "./tracker";
import { t } from "./i18n";

interface HerdrSettings {
  socketPath: string;
  herdrPath: string;
  /** Vault-relativer Ordner, den das Plugin beachtet (Geltungsbereich). Leer = ganzer Vault. */
  herdrFolder: string;
  submitWithEnter: boolean;
  autoCheck: boolean;
  workingTimeoutSec: number;
  idleTimeoutMin: number;
}

const DEFAULT_SETTINGS: HerdrSettings = {
  socketPath: "",
  herdrPath: "",
  herdrFolder: "herdr",
  submitWithEnter: true,
  autoCheck: true,
  workingTimeoutSec: 30,
  idleTimeoutMin: 30,
};

/** Letzter Pfadbestandteil (fuer die Unterscheidung gleichnamiger Spaces). */
function baseName(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? p;
}

/** Ersetzt in Vault-Dateinamen unzulaessige Zeichen durch '-'. */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export default class HerdrPlugin extends Plugin {
  settings: HerdrSettings = DEFAULT_SETTINGS;
  private tracker!: CompletionTracker;
  /** Notizen im kontinuierlichen Modus: Dateipfad -> zuletzt getrackte pane_id. */
  private continuous = new Map<string, string>();
  private statusBarEl!: HTMLElement;
  /** Monoton steigend; verwirft veraltete (ueberholte) Statusbar-Renders. */
  private statusSeq = 0;
  /**
   * Zuletzt bekannte Herdr-Spaces fuer das Ordner-Kontextmenue. Das
   * `file-menu`-Event ist synchron, deshalb kann das Menue nicht selbst auf
   * `workspace.list` warten -- es liest aus diesem Cache, der bei Layout-Ready
   * und bei jedem Oeffnen des Ordner-Menues (fuer das naechste Mal) aktualisiert
   * wird.
   */
  private spacesCache: WorkspaceView[] = [];

  async onload() {
    await this.loadSettings();
    this.tracker = new CompletionTracker(this.app);

    this.addCommand({
      id: "send-next-todo",
      name: t("cmd.sendNext"),
      callback: () => this.sendNextTodo(),
    });

    this.addCommand({
      id: "start-continuous",
      name: t("cmd.startContinuous"),
      callback: () => this.startContinuous(),
    });

    this.addCommand({
      id: "stop-continuous",
      name: t("cmd.stopContinuous"),
      callback: () => this.stopContinuous(),
    });

    this.addCommand({
      id: "ping",
      name: t("cmd.ping"),
      callback: () => this.pingHerdr(),
    });

    this.addSettingTab(new HerdrSettingTab(this.app, this));

    // Statusbar-Leiste unten: Buttons fuer Einzelschritt + kontinuierlich.
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("herdr-statusbar");
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.refreshStatusBar())
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.refreshStatusBar())
    );
    // Anzahl offener To-Dos aktualisieren, wenn die aktive Notiz sich aendert
    // (z.B. nach dem Auto-Abhaken).
    this.registerEvent(
      this.app.metadataCache.on("changed", (f) => {
        if (f === this.app.workspace.getActiveFile()) this.refreshStatusBar();
      })
    );
    this.refreshStatusBar();

    // Ordner-Kontextmenue: auf dem Herdr-Ordner ein Untermenue mit den
    // verfuegbaren Herdr-Spaces anbieten (Notiz anlegen/oeffnen).
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder && this.isHerdrScopeFolder(file)) {
          this.addSpaceMenu(menu, file);
          void this.refreshSpaces(); // fuer das naechste Oeffnen frisch halten
        }
      })
    );
    // Spaces einmal vorab laden, damit das erste Rechtsklick-Menue gefuellt ist.
    this.app.workspace.onLayoutReady(() => void this.refreshSpaces());
  }

  onunload() {
    this.tracker?.stopAll();
    this.continuous.clear();
  }

  resolveSocketPath(): string {
    return this.settings.socketPath.trim() || defaultSocketPath();
  }

  client(): HerdrClient {
    return new HerdrClient(this.resolveSocketPath());
  }

  /** Liegt die Datei im konfigurierten Herdr-Ordner? Leerer Ordner = ueberall. */
  private inHerdrFolder(file: TFile): boolean {
    const folder = this.settings.herdrFolder.trim().replace(/^\/+|\/+$/g, "");
    if (folder.length === 0) return true;
    return file.path === folder || file.path.startsWith(folder + "/");
  }

  /**
   * Ist `folder` der konfigurierte Herdr-Ordner? Bei leerer Einstellung
   * (= ganzer Vault als Geltungsbereich) qualifiziert sich jeder Ordner.
   */
  private isHerdrScopeFolder(folder: TFolder): boolean {
    const configured = this.settings.herdrFolder.trim().replace(/^\/+|\/+$/g, "");
    if (configured.length === 0) return true;
    return folder.path === configured;
  }

  /** Herdr-Spaces neu laden; bei Fehler bleibt der letzte Stand erhalten. */
  private async refreshSpaces(): Promise<void> {
    try {
      this.spacesCache = await this.client().workspaces();
    } catch {
      /* Herdr nicht erreichbar -> zuletzt bekannte Liste behalten */
    }
  }

  /**
   * Haengt an das Ordner-Kontextmenue ein Untermenue mit den Herdr-Spaces an.
   * `setSubmenu` ist erst ab Obsidian 1.4 (und nicht in den Typen) vorhanden --
   * fehlt es, werden die Spaces flach ins Menue gehaengt.
   */
  private addSpaceMenu(menu: Menu, folder: TFolder): void {
    menu.addItem((item) => {
      item.setTitle(t("menu.spaceNote")).setIcon("layout-grid");
      const setSubmenu = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu;
      if (typeof setSubmenu === "function") {
        this.fillSpaceItems(setSubmenu.call(item), folder);
      } else {
        item.setDisabled(true); // Eintrag dient nur als Ueberschrift
        this.fillSpaceItems(menu, folder);
      }
    });
  }

  /** Fuellt `target` (Untermenue oder Hauptmenue) mit einem Eintrag je Space. */
  private fillSpaceItems(target: Menu, folder: TFolder): void {
    const spaces = this.spacesCache;
    if (spaces.length === 0) {
      target.addItem((i) => i.setTitle(t("menu.noSpaces")).setDisabled(true));
      return;
    }
    // Mehrfach vorkommende Labels (z.B. zwei Workspaces gleichen Namens) per
    // cwd-Basename unterscheidbar machen.
    const counts = new Map<string, number>();
    for (const w of spaces) counts.set(w.label, (counts.get(w.label) ?? 0) + 1);
    for (const ws of spaces) {
      const ambiguous = (counts.get(ws.label) ?? 0) > 1 && ws.cwd;
      const title = ambiguous ? `${ws.label} — ${baseName(ws.cwd!)}` : ws.label;
      target.addItem((i) =>
        i
          .setTitle(title)
          .setIcon("terminal")
          .onClick(() => void this.openOrCreateNoteForSpace(folder, ws))
      );
    }
  }

  /**
   * Legt die zum Space passende Notiz im Ordner an (falls nicht vorhanden) oder
   * oeffnet sie. Dateiname = Space-Label; enthaelt das Label
   * dateinamens-unvertraegliche Zeichen, wird zusaetzlich `herdr-workspace:`
   * ins Frontmatter geschrieben, damit das Mapping trotzdem greift.
   */
  private async openOrCreateNoteForSpace(folder: TFolder, ws: WorkspaceView): Promise<void> {
    const base = sanitizeFileName(ws.label);
    if (base.length === 0) {
      new Notice(t("notice.noteCreateFailed", { error: ws.label }));
      return;
    }
    const dir = folder.isRoot() ? "" : folder.path;
    const path = normalizePath(dir ? `${dir}/${base}.md` : `${base}.md`);

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(existing);
      new Notice(t("notice.noteOpened", { name: existing.basename }));
      return;
    }

    const needFrontmatter = base !== ws.label;
    const content = needFrontmatter
      ? `---\nherdr-workspace: "${ws.label.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n---\n\n`
      : "";
    try {
      const created = await this.app.vault.create(path, content);
      await this.app.workspace.getLeaf(false).openFile(created);
      new Notice(t("notice.noteCreated", { label: ws.label, name: created.basename }));
    } catch (e) {
      new Notice(t("notice.noteCreateFailed", { error: (e as Error).message }));
    }
  }

  /** Statusbar-Leiste neu aufbauen (Sichtbarkeit + Buttons + Zaehler). */
  private refreshStatusBar() {
    void this.renderStatusBar();
  }

  private async renderStatusBar() {
    const el = this.statusBarEl;
    if (!el) return;
    const seq = ++this.statusSeq;
    const file = this.app.workspace.getActiveFile();

    // Nur fuer Notizen im Geltungsbereich anzeigen.
    if (!file || !this.inHerdrFolder(file)) {
      el.empty();
      el.hide();
      return;
    }

    let openCount = 0;
    try {
      const content = await this.app.vault.cachedRead(file);
      openCount = parseTodos(content).filter((t) => !t.done).length;
    } catch {
      /* Datei nicht lesbar -> 0 offene */
    }
    // Ein spaeter gestarteter Render hat uns ueberholt -> Ergebnis verwerfen.
    if (seq !== this.statusSeq) return;
    el.show();
    el.empty();
    const hasOpen = openCount > 0;
    const running = this.continuous.has(file.path);

    const label = el.createSpan({ cls: "herdr-sb-label" });
    label.setText(
      running ? t("sb.running", { count: openCount }) : t("sb.open", { count: openCount })
    );
    if (running) label.addClass("herdr-active");

    // Button 1: einzelnen Schritt senden.
    const stepBtn = el.createSpan({ cls: "clickable-icon herdr-sb-btn" });
    setIcon(stepBtn, "play");
    setTooltip(stepBtn, t("sb.tip.step"));
    if (hasOpen) {
      stepBtn.onclick = () => void this.sendNextTodo();
    } else {
      stepBtn.addClass("herdr-disabled");
    }

    // Button 2: kontinuierlichen Modus togglen (alle Schritte / stoppen).
    const allBtn = el.createSpan({ cls: "clickable-icon herdr-sb-btn" });
    if (running) {
      setIcon(allBtn, "square");
      allBtn.addClass("herdr-active");
      setTooltip(allBtn, t("sb.tip.stop"));
      allBtn.onclick = () => this.stopContinuous();
    } else {
      setIcon(allBtn, "chevrons-right");
      setTooltip(allBtn, t("sb.tip.all"));
      if (hasOpen) {
        allBtn.onclick = () => void this.startContinuous();
      } else {
        allBtn.addClass("herdr-disabled");
      }
    }
  }

  async pingHerdr() {
    try {
      const pong = await this.client().ping();
      new Notice(t("notice.herdrOk", { version: pong.version, protocol: pong.protocol }));
    } catch (e) {
      new Notice(t("notice.herdrUnreachable", { error: (e as Error).message }));
    }
  }

  /** Einzelnes Senden des naechsten offenen To-Dos der aktiven Notiz. */
  async sendNextTodo() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(t("notice.noActiveNote"));
      return;
    }
    await this.doSend(file, false);
  }

  async startContinuous() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(t("notice.noActiveNote"));
      return;
    }
    if (!this.settings.submitWithEnter) {
      new Notice(t("notice.continuousNeedsEnter"));
      return;
    }
    if (this.continuous.has(file.path)) {
      new Notice(t("notice.continuousAlreadyRunning", { name: file.basename }));
      return;
    }
    this.continuous.set(file.path, "");
    this.refreshStatusBar();
    new Notice(t("notice.continuousStarted", { name: file.basename }));
    await this.doSend(file, true);
  }

  stopContinuous() {
    const file = this.app.workspace.getActiveFile();
    if (file && this.continuous.has(file.path)) {
      this.endContinuous(file.path, t("notice.continuousStopped", { name: file.basename }));
      return;
    }
    // Fallback: nichts fuer die aktive Notiz -> alle laufenden stoppen.
    if (this.continuous.size > 0) {
      for (const path of [...this.continuous.keys()]) this.endContinuous(path);
      new Notice(t("notice.allContinuousStopped"));
    } else {
      new Notice(t("notice.noContinuous"));
    }
  }

  private endContinuous(filePath: string, notice?: string) {
    const paneId = this.continuous.get(filePath);
    this.continuous.delete(filePath);
    if (paneId) this.tracker.cancel(paneId);
    this.refreshStatusBar();
    if (notice) new Notice(notice);
  }

  /**
   * Sendet das naechste offene To-Do von `file`. Im kontinuierlichen Modus
   * wird nach Abschluss automatisch das naechste gesendet.
   */
  private async doSend(file: TFile, continuous: boolean) {
    if (!this.inHerdrFolder(file)) {
      new Notice(
        t("notice.notInFolder", { name: file.basename, folder: this.settings.herdrFolder })
      );
      if (continuous) this.endContinuous(file.path);
      return;
    }

    const content = await this.app.vault.read(file);
    const todo = nextOpen(content);
    if (!todo) {
      if (continuous) {
        this.endContinuous(file.path);
        new Notice(t("notice.allDoneContinuous", { name: file.basename }));
      } else {
        new Notice(t("notice.allDoneNothing"));
      }
      return;
    }

    const explicit = this.frontmatterWorkspace(file);

    try {
      const client = this.client();
      const workspaces = await client.workspaces();
      const ws = resolveWorkspace(workspaces, file.basename, explicit);

      if (!ws) {
        new Notice(
          t("notice.noWorkspace", {
            name: explicit ?? file.basename,
            available: workspaces.map((w) => w.label).join(", "),
          })
        );
        if (continuous) this.endContinuous(file.path);
        return;
      }
      if (!ws.pane_id) {
        new Notice(t("notice.noPane", { label: ws.label }));
        if (continuous) this.endContinuous(file.path);
        return;
      }

      const initialStatus = ws.agent_status;
      const paneId = ws.pane_id;
      await client.sendToPane(paneId, withContext(todo), this.settings.submitWithEnter);

      const wantTracking = continuous || (this.settings.autoCheck && this.settings.submitWithEnter);
      if (wantTracking) {
        if (continuous) this.continuous.set(file.path, paneId);
        this.tracker.track(
          paneId,
          file,
          todo.lineNo,
          todo.text,
          initialStatus,
          {
            herdrPath: this.settings.herdrPath.trim() || "herdr",
            socketPath: this.resolveSocketPath(),
            workingTimeoutMs: this.settings.workingTimeoutSec * 1000,
            idleTimeoutMs: this.settings.idleTimeoutMin * 60 * 1000,
            // Submit-Absicherung nur sinnvoll, wenn wir ueberhaupt Enter senden.
            resubmit: this.settings.submitWithEnter
              ? async () => {
                  await this.client().submit(paneId);
                }
              : undefined,
          },
          continuous ? (marked) => this.onContinuousStep(file, marked) : undefined
        );
        new Notice(
          t(continuous ? "notice.sentContinuous" : "notice.sentTracking", {
            label: ws.label,
            text: todo.text,
          })
        );
      } else {
        new Notice(t("notice.sent", { label: ws.label, text: todo.text }));
      }
    } catch (e) {
      new Notice(t("notice.sendFailed", { error: (e as Error).message }));
      if (continuous) this.endContinuous(file.path);
    }
  }

  /** Nach Abschluss eines To-Dos im kontinuierlichen Modus: naechstes senden. */
  private onContinuousStep(file: TFile, marked: boolean) {
    if (!this.continuous.has(file.path)) return; // wurde gestoppt
    if (!marked) {
      this.endContinuous(file.path, t("notice.continuousPaused", { name: file.basename }));
      return;
    }
    void this.doSend(file, true);
  }

  /** Liest `herdr-workspace` aus dem Frontmatter, falls vorhanden. */
  private frontmatterWorkspace(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    const val = fm?.["herdr-workspace"];
    return typeof val === "string" && val.length > 0 ? val : null;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class HerdrSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HerdrPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("set.folder.name"))
      .setDesc(t("set.folder.desc"))
      .addText((t) =>
        t
          .setPlaceholder("herdr")
          .setValue(this.plugin.settings.herdrFolder)
          .onChange(async (v) => {
            this.plugin.settings.herdrFolder = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("set.socket.name"))
      .setDesc(t("set.socket.desc"))
      .addText((t) =>
        t
          .setPlaceholder(defaultSocketPath())
          .setValue(this.plugin.settings.socketPath)
          .onChange(async (v) => {
            this.plugin.settings.socketPath = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("set.herdrPath.name"))
      .setDesc(t("set.herdrPath.desc"))
      .addText((t) =>
        t
          .setPlaceholder("herdr")
          .setValue(this.plugin.settings.herdrPath)
          .onChange(async (v) => {
            this.plugin.settings.herdrPath = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("set.submitEnter.name"))
      .setDesc(t("set.submitEnter.desc"))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.submitWithEnter).onChange(async (v) => {
          this.plugin.settings.submitWithEnter = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("set.autoCheck.name"))
      .setDesc(t("set.autoCheck.desc"))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoCheck).onChange(async (v) => {
          this.plugin.settings.autoCheck = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("set.workingTimeout.name"))
      .setDesc(t("set.workingTimeout.desc"))
      .addText((t) =>
        t.setValue(String(this.plugin.settings.workingTimeoutSec)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.settings.workingTimeoutSec = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName(t("set.idleTimeout.name"))
      .setDesc(t("set.idleTimeout.desc"))
      .addText((t) =>
        t.setValue(String(this.plugin.settings.idleTimeoutMin)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.settings.idleTimeoutMin = n;
            await this.plugin.saveSettings();
          }
        })
      );
  }
}

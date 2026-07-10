import {
  App,
  MarkdownView,
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
import { HerdrClient, TabView, WorkspaceView, defaultSocketPath } from "./herdr-client";
import { nextOpen, parseSections, parseTodos, withContext, TodoItem } from "./todos";
import { parseSpaceTab, resolveTab, resolveWorkspace } from "./mapping";
import { CompletionTracker } from "./tracker";
import { DisplayState, ExplorerDecorator, GLYPH, IconState } from "./explorer-icons";
import { MultiAgentChoice, MultiAgentChooserModal, TabPickerModal } from "./multi-agent";
import {
  HeadingIcon,
  refreshAllHeadingIcons,
  sectionHeadingIcons,
} from "./section-heading-icons";
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
  /** Agent-Status-Icons im Datei-Explorer anzeigen. */
  explorerStatusIcons: boolean;
  /** Poll-Intervall (Sekunden) fuer die Explorer-Status-Icons. */
  explorerPollSec: number;
}

const DEFAULT_SETTINGS: HerdrSettings = {
  socketPath: "",
  herdrPath: "",
  herdrFolder: "herdr",
  submitWithEnter: true,
  autoCheck: true,
  workingTimeoutSec: 30,
  idleTimeoutMin: 30,
  explorerStatusIcons: true,
  explorerPollSec: 3,
};

/** Herdr-Status, die einen echten Agent bedeuten (nicht "unknown"). */
const AGENT_STATES = new Set(["idle", "done", "working", "blocked"]);

/** Herdr-`agent_status` -> Anzeige-Zustand (alles Unbekannte -> "none"). */
function toDisplayState(status: string | undefined): DisplayState {
  switch (status) {
    case "idle":
    case "done":
    case "working":
    case "blocked":
      return status;
    default:
      return "none";
  }
}

/** Ziel eines Sendevorgangs: aufgeloester Pane samt Anzeige-Label. */
interface SendTarget {
  ws: WorkspaceView;
  paneId: string;
  status: string;
  /** Tab-Label fuer die Anzeige; leer = nicht anzeigen (Single-Tab-Space). */
  tabLabel: string;
}

/** Ergebnis der Ziel-Aufloesung einer Notiz. */
type Resolution =
  | { kind: "ok"; target: SendTarget }
  | { kind: "ambiguous"; ws: WorkspaceView; tabs: TabView[] }
  | { kind: "no-workspace"; available: string[] }
  | { kind: "no-agent"; ws: WorkspaceView }
  | { kind: "tab-not-found"; ws: WorkspaceView; hint: string };

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
  /**
   * Notizen im kontinuierlichen Modus: Dateipfad -> Menge getrackter pane_ids
   * (mehr als eine nur im Sektions-Modus, sonst genau eine).
   */
  private continuous = new Map<string, Set<string>>();
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
  /** Zuletzt bekannte Tabs je Workspace (fuer Multi-Tab-Icons/Ziel-Anzeige). */
  private tabsCache = new Map<string, TabView[]>();
  /** Datei-Explorer-Icons (Herdr-Agent-Status). */
  private explorer!: ExplorerDecorator;
  /** Verhindert ueberlappende Status-Polls. */
  private explorerPolling = false;

  async onload() {
    await this.loadSettings();
    this.tracker = new CompletionTracker(this.app);
    this.explorer = new ExplorerDecorator(this.app, {
      getStates: (file) => this.explorerStatesForFile(file),
      inScope: (file) => this.inHerdrFolder(file),
      enabled: () => this.settings.explorerStatusIcons,
      label: (state) => t(`status.${state}`),
    });

    this.addCommand({
      id: "send-next-todo",
      name: t("cmd.sendNext"),
      callback: () => this.sendNextTodo(),
    });

    this.addCommand({
      id: "configure-multi-agent",
      name: t("cmd.configureMulti"),
      callback: () => void this.configureMultiAgent(),
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

    // Status-Icon in Sektions-Überschriften (Live Preview, CM6).
    this.registerEditorExtension(sectionHeadingIcons((h) => this.resolveHeadingIcon(h)));

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

    // Explorer-Status-Icons: periodisch pollen (Herdr-Events sind laut CLAUDE.md
    // unzuverlaessig) und bei DOM-/Vault-Aenderungen neu anwenden.
    this.registerInterval(
      window.setInterval(
        () => void this.refreshExplorerStatus(),
        Math.max(1, this.settings.explorerPollSec) * 1000
      )
    );
    const reapply = () => this.explorer.apply();
    this.registerEvent(this.app.vault.on("create", reapply));
    this.registerEvent(this.app.vault.on("rename", reapply));
    this.registerEvent(this.app.vault.on("delete", reapply));
    this.registerEvent(this.app.workspace.on("layout-change", reapply));
    this.app.workspace.onLayoutReady(() => {
      this.explorer.start();
      void this.refreshExplorerStatus();
    });
  }

  onunload() {
    this.tracker?.stopAll();
    this.continuous.clear();
    this.explorer?.stop();
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

  /** Reaktion auf das Umschalten des Explorer-Icon-Toggles in den Einstellungen. */
  onExplorerIconsToggled(on: boolean): void {
    if (on) {
      this.explorer.start();
      void this.refreshExplorerStatus();
    } else {
      this.explorer.clearAll();
    }
  }

  /** Spaces + Tabs neu holen und die Explorer-Icons aktualisieren (kein Overlap). */
  private async refreshExplorerStatus(): Promise<void> {
    if (!this.settings.explorerStatusIcons || this.explorerPolling) return;
    this.explorerPolling = true;
    try {
      await this.refreshSpaces();
      await this.refreshTabs();
      this.explorer.apply();
      refreshAllHeadingIcons(); // Heading-Icons mit frischem Status neu zeichnen
    } finally {
      this.explorerPolling = false;
    }
  }

  /** Icon fuer eine Sektions-Überschrift `# <space>.<tab>` der aktiven Notiz. */
  private resolveHeadingIcon(headingText: string): HeadingIcon | null {
    if (!this.settings.explorerStatusIcons) return null;
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file || !this.inHerdrFolder(file) || !this.isSectionsMode(file)) return null;
    const ws = resolveWorkspace(this.spacesCache, file.basename, this.frontmatterWorkspace(file));
    if (!ws) return null;
    const prefix = ws.label + ".";
    if (!headingText.startsWith(prefix) || headingText.length <= prefix.length) return null;
    const token = headingText.slice(prefix.length);
    const tab = resolveTab(this.tabsCache.get(ws.workspace_id) ?? [], token);
    const state = toDisplayState(tab?.agent_status);
    return { glyph: GLYPH[state], cls: `herdr-st-${state}`, tip: `${token}: ${t(`status.${state}`)}` };
  }

  /** Alle Tabs holen und nach Workspace gruppiert cachen (fuer die Icons). */
  private async refreshTabs(): Promise<void> {
    try {
      const all = await this.client().tabs();
      const map = new Map<string, TabView[]>();
      for (const tb of all) {
        const arr = map.get(tb.workspace_id) ?? [];
        arr.push(tb);
        map.set(tb.workspace_id, arr);
      }
      this.tabsCache = map;
    } catch {
      /* Herdr nicht erreichbar -> letzten Stand behalten */
    }
  }

  /**
   * Icons einer Notiz: mappt auf einen Workspace und liefert den Status des
   * (ggf. gewaehlten) Tabs. `agent_status` ist autoritativ -- "kein Agent" =
   * kein Mapping bzw. `unknown`. Sektions-Notizen (mehrere Tabs) folgen spaeter.
   */
  private explorerStatesForFile(file: TFile): IconState[] {
    const explicit = this.frontmatterWorkspace(file);
    const parsed = parseSpaceTab(file.basename);
    let ws = resolveWorkspace(this.spacesCache, file.basename, explicit);
    let hint = this.frontmatterTab(file);
    if (!ws && parsed.tab) {
      ws = resolveWorkspace(this.spacesCache, parsed.space, explicit);
      if (ws && !hint) hint = parsed.tab;
    }
    if (!ws) return [{ key: "none", label: "", state: "none" }];

    const tabs = this.tabsCache.get(ws.workspace_id) ?? [];
    const agentTabs = tabs.filter((tb) => AGENT_STATES.has(tb.agent_status));

    // Sektions-Notiz: ein Icon je Sektions-Tab (in Dokumentreihenfolge).
    if (this.isSectionsMode(file)) {
      const cache = this.app.metadataCache.getFileCache(file);
      const tokens = (cache?.headings ?? [])
        .map((h) => h.heading)
        .filter((h) => h.startsWith(ws!.label + "."))
        .map((h) => h.slice(ws!.label.length + 1));
      if (tokens.length > 0) {
        return tokens.map((tok) => {
          const tab = resolveTab(tabs, tok);
          return { key: `s:${tok}`, label: tok, state: toDisplayState(tab?.agent_status) };
        });
      }
    }

    if (hint) {
      const tab = resolveTab(tabs, hint);
      return [{ key: "tab", label: tab?.label ?? hint, state: toDisplayState(tab?.agent_status) }];
    }
    if (agentTabs.length <= 1) {
      const status = agentTabs[0]?.agent_status ?? ws.agent_status;
      return [{ key: "single", label: "", state: toDisplayState(status) }];
    }
    // Mehrere Agent-Tabs, keine Zuordnung -> aggregierter Space-Status.
    return [{ key: "agg", label: "", state: toDisplayState(ws.agent_status) }];
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
    this.continuous.set(file.path, new Set());
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
    const panes = this.continuous.get(filePath);
    this.continuous.delete(filePath);
    if (panes) for (const paneId of panes) this.tracker.cancel(paneId);
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

    // Sektions-Modus (Option 2): Einzelschritt an die Cursor-Sektion,
    // kontinuierlicher Start an alle Sektionen.
    if (this.isSectionsMode(file)) {
      await this.sendSections(
        file,
        continuous,
        continuous ? {} : { cursorLine: this.activeCursorLine(file) }
      );
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

    try {
      const res = await this.resolveSendTarget(file);
      switch (res.kind) {
        case "no-workspace":
          new Notice(
            t("notice.noWorkspace", {
              name: this.frontmatterWorkspace(file) ?? file.basename,
              available: res.available.join(", "),
            })
          );
          if (continuous) this.endContinuous(file.path);
          return;
        case "no-agent":
          new Notice(t("notice.noPane", { label: res.ws.label }));
          if (continuous) this.endContinuous(file.path);
          return;
        case "tab-not-found":
          new Notice(t("notice.tabNotFound", { label: res.ws.label, tab: res.hint }));
          if (continuous) this.endContinuous(file.path);
          return;
        case "ambiguous": {
          const choice = await new MultiAgentChooserModal(
            this.app,
            res.ws.label,
            res.tabs.length
          ).openAndWait();
          if (!choice) {
            if (continuous) this.endContinuous(file.path);
            return;
          }
          await this.applyChoice(file, res.ws, res.tabs, choice, todo, continuous);
          return;
        }
        case "ok":
          await this.sendTodoAndTrack(file, todo, res.target, continuous);
          return;
      }
    } catch (e) {
      new Notice(t("notice.sendFailed", { error: (e as Error).message }));
      if (continuous) this.endContinuous(file.path);
    }
  }

  /**
   * Sendet EIN To-Do an einen Pane und startet ggf. Tracking/Verkettung.
   * `sectionToken` gesetzt = Sektions-Modus: die Verkettung sendet das naechste
   * To-Do DERSELBEN Sektion (sonst das naechste offene der ganzen Datei).
   */
  private async sendTodoAndTrack(
    file: TFile,
    todo: TodoItem,
    target: SendTarget,
    continuous: boolean,
    sectionToken?: string
  ): Promise<void> {
    const { ws, paneId, status, tabLabel } = target;
    const label = tabLabel ? `${ws.label}.${tabLabel}` : ws.label;
    await this.client().sendToPane(paneId, withContext(todo), this.settings.submitWithEnter);

    const wantTracking = continuous || (this.settings.autoCheck && this.settings.submitWithEnter);
    if (!wantTracking) {
      new Notice(t("notice.sent", { label, text: todo.text }));
      return;
    }
    if (continuous) (this.continuous.get(file.path) ?? this.ensureContinuous(file.path)).add(paneId);
    this.tracker.track(
      paneId,
      file,
      todo.lineNo,
      todo.text,
      status,
      {
        herdrPath: this.settings.herdrPath.trim() || "herdr",
        socketPath: this.resolveSocketPath(),
        workingTimeoutMs: this.settings.workingTimeoutSec * 1000,
        idleTimeoutMs: this.settings.idleTimeoutMin * 60 * 1000,
        resubmit: this.settings.submitWithEnter
          ? async () => {
              await this.client().submit(paneId);
            }
          : undefined,
      },
      continuous
        ? (marked) =>
            sectionToken !== undefined
              ? this.onContinuousStepSection(file, marked, sectionToken)
              : this.onContinuousStep(file, marked)
        : undefined
    );
    new Notice(
      t(continuous ? "notice.sentContinuous" : "notice.sentTracking", { label, text: todo.text })
    );
  }

  private ensureContinuous(filePath: string): Set<string> {
    let set = this.continuous.get(filePath);
    if (!set) {
      set = new Set();
      this.continuous.set(filePath, set);
    }
    return set;
  }

  /** Verkettung (Einzelziel): naechstes offenes To-Do der ganzen Datei senden. */
  private onContinuousStep(file: TFile, marked: boolean) {
    if (!this.continuous.has(file.path)) return; // wurde gestoppt
    if (!marked) {
      this.endContinuous(file.path, t("notice.continuousPaused", { name: file.basename }));
      return;
    }
    void this.doSend(file, true);
  }

  /** Verkettung (Sektions-Modus): naechstes offenes To-Do DIESER Sektion. */
  private onContinuousStepSection(file: TFile, marked: boolean, token: string) {
    if (!this.continuous.has(file.path)) return;
    if (!marked) {
      this.endContinuous(file.path, t("notice.continuousPaused", { name: file.basename }));
      return;
    }
    void this.sendSections(file, true, { onlyToken: token });
  }

  // ---- Multi-Agent: Auswahl-Flow (Option 1/2/3) ----

  /** Ist die Notiz im Sektions-Modus (Frontmatter `herdr-mode: sections`)? */
  private isSectionsMode(file: TFile): boolean {
    return this.frontmatterString(file, "herdr-mode") === "sections";
  }

  /** Setzt die gewaehlte Option um (persistiert) und sendet ggf. `todo`. */
  private async applyChoice(
    file: TFile,
    ws: WorkspaceView,
    tabs: TabView[],
    choice: MultiAgentChoice,
    todo: TodoItem | null,
    continuous: boolean
  ): Promise<void> {
    if (choice === "single") {
      const tab = await new TabPickerModal(
        this.app,
        tabs,
        (s) => GLYPH[s],
        (s) => t(`status.${s}`),
        toDisplayState
      ).openAndWait();
      if (!tab || !tab.pane_id) {
        if (continuous) this.endContinuous(file.path);
        return;
      }
      // Erst senden (Zeilennummern noch exakt), dann Wahl persistieren.
      if (todo) {
        await this.sendTodoAndTrack(
          file,
          todo,
          { ws, paneId: tab.pane_id, status: tab.agent_status, tabLabel: tab.label },
          continuous
        );
      }
      await this.setFrontmatter(file, { "herdr-tab": tab.label });
      new Notice(t("notice.tabChosen", { label: `${ws.label}.${tab.label}` }));
      return;
    }
    if (choice === "split") {
      await this.splitIntoTabFiles(file, ws, tabs);
      // Datei traegt jetzt den Tab-Suffix -> erneutes Senden trifft Tab 1.
      if (todo) await this.doSend(file, continuous);
      return;
    }
    // sections
    await this.setupSections(file, ws, tabs);
    // Direkt sektionsweise senden (umgeht den metadataCache-Verzug).
    if (todo) await this.sendSections(file, continuous);
  }

  /** Frontmatter-Eintraege sicher setzen. */
  private async setFrontmatter(file: TFile, entries: Record<string, string>): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      for (const [k, v] of Object.entries(entries)) fm[k] = v;
    });
  }

  /** Option 3: Original -> `<space>.<tab1>.md`, weitere Tabs als leere Dateien. */
  private async splitIntoTabFiles(
    file: TFile,
    ws: WorkspaceView,
    tabs: TabView[]
  ): Promise<void> {
    const agentTabs = tabs.filter((tb) => tb.pane_id && AGENT_STATES.has(tb.agent_status));
    if (agentTabs.length === 0) return;
    const dir = file.parent && !file.parent.isRoot() ? file.parent.path : "";
    const space = file.basename;
    const pathFor = (label: string) => {
      const name = `${space}.${sanitizeFileName(label)}.md`;
      return normalizePath(dir ? `${dir}/${name}` : name);
    };
    await this.app.fileManager.renameFile(file, pathFor(agentTabs[0].label));
    for (const tb of agentTabs.slice(1)) {
      const p = pathFor(tb.label);
      if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.create(p, "");
    }
    new Notice(t("notice.splitDone", { count: String(agentTabs.length), name: space }));
  }

  /** Option 2: Ueberschriften `# <space>.<tab>` einfuegen, To-Dos unter Sektion 1. */
  private async setupSections(file: TFile, ws: WorkspaceView, tabs: TabView[]): Promise<void> {
    const agentTabs = tabs.filter((tb) => AGENT_STATES.has(tb.agent_status));
    if (agentTabs.length === 0) return;
    const content = await this.app.vault.read(file);
    const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
    const fm = fmMatch ? fmMatch[0] : "";
    const body = (fmMatch ? content.slice(fm.length) : content).trim();
    const tokens = agentTabs.map((tb) => tb.label);
    let newBody = `# ${ws.label}.${tokens[0]}\n\n${body}\n`;
    for (const tok of tokens.slice(1)) newBody += `\n# ${ws.label}.${tok}\n\n`;
    await this.app.vault.modify(file, fm + newBody);
    await this.setFrontmatter(file, { "herdr-mode": "sections" });
    new Notice(t("notice.sectionsDone", { count: String(tokens.length), name: ws.label }));
  }

  /**
   * Sektions-Modus: To-Dos je Sektion an ihren Tab senden.
   * - `onlyToken` gesetzt -> nur diese Sektion (Verkettung).
   * - sonst `cursorLine` gesetzt -> nur die Sektion, in der der Cursor steht.
   * - sonst -> alle Sektionen (Voll-Durchlauf / kontinuierlicher Start).
   */
  private async sendSections(
    file: TFile,
    continuous: boolean,
    opts: { onlyToken?: string; cursorLine?: number } = {}
  ): Promise<void> {
    try {
      const client = this.client();
      const explicit = this.frontmatterWorkspace(file);
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
      const tabs = await client.tabs(ws.workspace_id);
      const content = await this.app.vault.read(file);
      const all = parseSections(content, ws.label);

      // Filter bestimmen: Verkettung > Cursor-Sektion > alle.
      let token = opts.onlyToken;
      if (token === undefined && opts.cursorLine != null) {
        const here = [...all].reverse().find((s) => s.headingLine <= opts.cursorLine!);
        if (here) token = here.tabToken;
      }
      const scoped = token !== undefined; // gezielt (Verkettung oder Cursor)
      const sections = token === undefined ? all : all.filter((s) => s.tabToken === token);

      let sent = false;
      for (const sec of sections) {
        const todo = sec.todos.find((td) => !td.done);
        if (!todo) continue;
        const tab = resolveTab(tabs, sec.tabToken);
        if (!tab || !tab.pane_id) {
          new Notice(t("notice.tabNotFound", { label: ws.label, tab: sec.tabToken }));
          continue;
        }
        await this.sendTodoAndTrack(
          file,
          todo,
          { ws, paneId: tab.pane_id, status: tab.agent_status, tabLabel: tab.label },
          continuous,
          sec.tabToken
        );
        sent = true;
      }
      // Nichts gesendet: bei Verkettung stumm; sonst Rueckmeldung/Stopp.
      if (!sent && opts.onlyToken === undefined) {
        if (continuous) {
          this.endContinuous(file.path);
          new Notice(t("notice.allDoneContinuous", { name: file.basename }));
        } else {
          new Notice(scoped ? t("notice.sectionAllDone") : t("notice.allDoneNothing"));
        }
      }
    } catch (e) {
      new Notice(t("notice.sendFailed", { error: (e as Error).message }));
      if (continuous) this.endContinuous(file.path);
    }
  }

  /** Cursor-Zeile, falls die aktive Notiz `file` gerade im Editor offen ist. */
  private activeCursorLine(file: TFile): number | undefined {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file !== file) return undefined;
    return view.editor.getCursor().line;
  }

  /** Command: Multi-Agent-Handhabung fuer die aktive Notiz (neu) waehlen. */
  private async configureMultiAgent(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(t("notice.noActiveNote"));
      return;
    }
    if (!this.inHerdrFolder(file)) {
      new Notice(
        t("notice.notInFolder", { name: file.basename, folder: this.settings.herdrFolder })
      );
      return;
    }
    try {
      const client = this.client();
      const explicit = this.frontmatterWorkspace(file);
      const parsed = parseSpaceTab(file.basename);
      const workspaces = await client.workspaces();
      let ws = resolveWorkspace(workspaces, file.basename, explicit);
      if (!ws && parsed.tab) ws = resolveWorkspace(workspaces, parsed.space, explicit);
      if (!ws) {
        new Notice(
          t("notice.noWorkspace", {
            name: explicit ?? file.basename,
            available: workspaces.map((w) => w.label).join(", "),
          })
        );
        return;
      }
      const tabs = await client.tabs(ws.workspace_id);
      const agentTabs = tabs.filter((tb) => tb.pane_id && AGENT_STATES.has(tb.agent_status));
      if (agentTabs.length < 2) {
        new Notice(t("notice.singleAgent", { label: ws.label }));
        return;
      }
      const choice = await new MultiAgentChooserModal(
        this.app,
        ws.label,
        agentTabs.length
      ).openAndWait();
      if (!choice) return;
      await this.applyChoice(file, ws, agentTabs, choice, null, false);
    } catch (e) {
      new Notice(t("notice.sendFailed", { error: (e as Error).message }));
    }
  }

  /** Liest `herdr-workspace` aus dem Frontmatter, falls vorhanden. */
  private frontmatterWorkspace(file: TFile): string | null {
    return this.frontmatterString(file, "herdr-workspace");
  }

  /** Liest `herdr-tab` (Tab-Label/-Nummer) aus dem Frontmatter, falls vorhanden. */
  private frontmatterTab(file: TFile): string | null {
    return this.frontmatterString(file, "herdr-tab");
  }

  private frontmatterString(file: TFile, key: string): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    const val = fm?.[key];
    if (typeof val === "string" && val.length > 0) return val;
    if (typeof val === "number") return String(val); // herdr-tab: 2 (YAML-Zahl)
    return null;
  }

  /**
   * Loest die Notiz auf ein konkretes Sendeziel (Space + Tab -> pane_id) auf.
   * Tab-Hinweis: Frontmatter `herdr-tab` > Dateiname-Suffix `<space>.<tab>`.
   * Ohne Hinweis: genau ein Agent-Tab -> dieser; mehrere -> "ambiguous".
   */
  private async resolveSendTarget(file: TFile): Promise<Resolution> {
    const explicit = this.frontmatterWorkspace(file);
    const parsed = parseSpaceTab(file.basename);
    const client = this.client();
    const workspaces = await client.workspaces();

    // Erst voller Basename (deckt Labels mit Punkt), dann Space-Teil des Suffix.
    let ws = resolveWorkspace(workspaces, file.basename, explicit);
    let tabHint = this.frontmatterTab(file);
    if (!ws && parsed.tab) {
      ws = resolveWorkspace(workspaces, parsed.space, explicit);
      if (ws && !tabHint) tabHint = parsed.tab;
    }
    if (!ws) return { kind: "no-workspace", available: workspaces.map((w) => w.label) };

    const tabs = await client.tabs(ws.workspace_id);
    const agentTabs = tabs.filter((tb) => tb.pane_id && AGENT_STATES.has(tb.agent_status));

    if (tabHint) {
      const tab = resolveTab(tabs, tabHint);
      if (!tab || !tab.pane_id) return { kind: "tab-not-found", ws, hint: tabHint };
      return {
        kind: "ok",
        target: { ws, paneId: tab.pane_id, status: tab.agent_status, tabLabel: tab.label },
      };
    }
    if (agentTabs.length === 1) {
      const tb = agentTabs[0];
      // Single-Tab-Space: Tab-Label nicht anzeigen (kein Mehrwert).
      return {
        kind: "ok",
        target: { ws, paneId: tb.pane_id!, status: tb.agent_status, tabLabel: "" },
      };
    }
    if (agentTabs.length === 0) {
      // Alt-Fallback: pane_id aus workspaces() (falls tab.list nichts hergibt).
      if (ws.pane_id) {
        return {
          kind: "ok",
          target: { ws, paneId: ws.pane_id, status: ws.agent_status, tabLabel: "" },
        };
      }
      return { kind: "no-agent", ws };
    }
    return { kind: "ambiguous", ws, tabs: agentTabs };
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

    new Setting(containerEl)
      .setName(t("set.explorerIcons.name"))
      .setDesc(t("set.explorerIcons.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.explorerStatusIcons).onChange(async (v) => {
          this.plugin.settings.explorerStatusIcons = v;
          await this.plugin.saveSettings();
          this.plugin.onExplorerIconsToggled(v);
        })
      );

    new Setting(containerEl)
      .setName(t("set.explorerPoll.name"))
      .setDesc(t("set.explorerPoll.desc"))
      .addText((tx) =>
        tx.setValue(String(this.plugin.settings.explorerPollSec)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.settings.explorerPollSec = n;
            await this.plugin.saveSettings();
          }
        })
      );
  }
}

import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  setIcon,
  setTooltip,
} from "obsidian";
import { HerdrClient, defaultSocketPath } from "./herdr-client";
import { nextOpen, parseTodos } from "./todos";
import { resolveWorkspace } from "./mapping";
import { CompletionTracker } from "./tracker";

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

export default class HerdrPlugin extends Plugin {
  settings: HerdrSettings = DEFAULT_SETTINGS;
  private tracker!: CompletionTracker;
  /** Notizen im kontinuierlichen Modus: Dateipfad -> zuletzt getrackte pane_id. */
  private continuous = new Map<string, string>();
  private statusBarEl!: HTMLElement;
  /** Monoton steigend; verwirft veraltete (ueberholte) Statusbar-Renders. */
  private statusSeq = 0;

  async onload() {
    await this.loadSettings();
    this.tracker = new CompletionTracker(this.app);

    this.addCommand({
      id: "send-next-todo",
      name: "Naechstes offenes To-Do an den Agent senden",
      callback: () => this.sendNextTodo(),
    });

    this.addCommand({
      id: "start-continuous",
      name: "Kontinuierlichen Modus fuer diese Notiz starten",
      callback: () => this.startContinuous(),
    });

    this.addCommand({
      id: "stop-continuous",
      name: "Kontinuierlichen Modus stoppen",
      callback: () => this.stopContinuous(),
    });

    this.addCommand({
      id: "ping",
      name: "Verbindung zu Herdr testen (ping)",
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
    label.setText(running ? `Herdr: laeuft (${openCount})` : `Herdr: ${openCount} offen`);
    if (running) label.addClass("herdr-active");

    // Button 1: einzelnen Schritt senden.
    const stepBtn = el.createSpan({ cls: "clickable-icon herdr-sb-btn" });
    setIcon(stepBtn, "play");
    setTooltip(stepBtn, "Naechstes To-Do an den Agent senden");
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
      setTooltip(allBtn, "Kontinuierlichen Modus stoppen");
      allBtn.onclick = () => this.stopContinuous();
    } else {
      setIcon(allBtn, "chevrons-right");
      setTooltip(allBtn, "Alle To-Dos kontinuierlich abarbeiten");
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
      new Notice(`Herdr OK: v${pong.version} (Protokoll ${pong.protocol})`);
    } catch (e) {
      new Notice(`Herdr nicht erreichbar: ${(e as Error).message}`);
    }
  }

  /** Einzelnes Senden des naechsten offenen To-Dos der aktiven Notiz. */
  async sendNextTodo() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Keine aktive Notiz.");
      return;
    }
    await this.doSend(file, false);
  }

  async startContinuous() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Keine aktive Notiz.");
      return;
    }
    if (!this.settings.submitWithEnter) {
      new Notice("Kontinuierlicher Modus benoetigt 'Mit Enter abschicken'.");
      return;
    }
    if (this.continuous.has(file.path)) {
      new Notice(`Kontinuierlicher Modus laeuft bereits fuer "${file.basename}".`);
      return;
    }
    this.continuous.set(file.path, "");
    this.refreshStatusBar();
    new Notice(`Kontinuierlicher Modus gestartet: "${file.basename}"`);
    await this.doSend(file, true);
  }

  stopContinuous() {
    const file = this.app.workspace.getActiveFile();
    if (file && this.continuous.has(file.path)) {
      this.endContinuous(file.path, `Kontinuierlicher Modus gestoppt: "${file.basename}"`);
      return;
    }
    // Fallback: nichts fuer die aktive Notiz -> alle laufenden stoppen.
    if (this.continuous.size > 0) {
      for (const path of [...this.continuous.keys()]) this.endContinuous(path);
      new Notice("Alle kontinuierlichen Modi gestoppt.");
    } else {
      new Notice("Kein kontinuierlicher Modus aktiv.");
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
        `"${file.basename}" liegt nicht im Herdr-Ordner ("${this.settings.herdrFolder}").`
      );
      if (continuous) this.endContinuous(file.path);
      return;
    }

    const content = await this.app.vault.read(file);
    const todo = nextOpen(content);
    if (!todo) {
      if (continuous) {
        this.endContinuous(file.path);
        new Notice(`Alle To-Dos erledigt -- kontinuierlicher Modus beendet: "${file.basename}"`);
      } else {
        new Notice("Alle To-Dos erledigt -- nichts zu senden.");
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
          `Kein Herdr-Workspace fuer "${explicit ?? file.basename}" gefunden. ` +
            `Verfuegbar: ${workspaces.map((w) => w.label).join(", ")}`
        );
        if (continuous) this.endContinuous(file.path);
        return;
      }
      if (!ws.pane_id) {
        new Notice(`Workspace "${ws.label}" hat keinen Agent/Pane.`);
        if (continuous) this.endContinuous(file.path);
        return;
      }

      const initialStatus = ws.agent_status;
      const paneId = ws.pane_id;
      await client.sendToPane(paneId, todo.text, this.settings.submitWithEnter);

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
          },
          continuous ? (marked) => this.onContinuousStep(file, marked) : undefined
        );
        const tail = continuous ? " [kontinuierlich]" : " (wird abgehakt, wenn fertig)";
        new Notice(`-> ${ws.label}: "${todo.text}"${tail}`);
      } else {
        new Notice(`-> ${ws.label}: "${todo.text}"`);
      }
    } catch (e) {
      new Notice(`Senden fehlgeschlagen: ${(e as Error).message}`);
      if (continuous) this.endContinuous(file.path);
    }
  }

  /** Nach Abschluss eines To-Dos im kontinuierlichen Modus: naechstes senden. */
  private onContinuousStep(file: TFile, marked: boolean) {
    if (!this.continuous.has(file.path)) return; // wurde gestoppt
    if (!marked) {
      this.endContinuous(
        file.path,
        `Kontinuierlicher Modus angehalten (Timeout/kein Arbeitsbeginn): "${file.basename}"`
      );
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
      .setName("Herdr-Ordner")
      .setDesc(
        "Vault-relativer Ordner, den das Plugin beachtet (z.B. 'herdr' oder 'projekte/herdr'). " +
          "Der Dateiname einer Notiz darin steht fuer den Workspace. Leer = ganzer Vault."
      )
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
      .setName("Socket-Pfad")
      .setDesc(
        "Pfad zum Herdr-API-Socket. Leer = Standard ($HERDR_SOCKET_PATH oder ~/.config/herdr/herdr.sock)."
      )
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
      .setName("herdr-Programmpfad")
      .setDesc(
        "Pfad zum herdr-Binary fuer das Auto-Abhaken (nutzt `herdr agent wait`). " +
          "Leer = `herdr` aus dem PATH. Falls Obsidian den PATH nicht kennt, vollen Pfad eintragen (z.B. ~/.local/bin/herdr)."
      )
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
      .setName("Mit Enter abschicken")
      .setDesc("Nach dem To-Do-Text automatisch Enter senden (Agent startet sofort).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.submitWithEnter).onChange(async (v) => {
          this.plugin.settings.submitWithEnter = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Automatisch abhaken")
      .setDesc(
        "Checkbox abhaken, sobald der Agent nach dem Senden fertig ist (working -> idle). " +
          "Benoetigt 'Mit Enter abschicken'."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoCheck).onChange(async (v) => {
          this.plugin.settings.autoCheck = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Timeout Arbeitsbeginn (Sekunden)")
      .setDesc("Wie lange auf den Wechsel zu 'working' gewartet wird, bevor das Auto-Abhaken aufgibt.")
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
      .setName("Timeout Fertigstellung (Minuten)")
      .setDesc("Maximale Wartezeit auf 'idle' (Agent fertig), bevor das Auto-Abhaken aufgibt.")
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

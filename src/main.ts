import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";
import { HerdrClient, defaultSocketPath } from "./herdr-client";
import { nextOpen } from "./todos";
import { resolveWorkspace } from "./mapping";

interface HerdrSettings {
  socketPath: string;
  submitWithEnter: boolean;
}

const DEFAULT_SETTINGS: HerdrSettings = {
  socketPath: "",
  submitWithEnter: true,
};

export default class HerdrPlugin extends Plugin {
  settings: HerdrSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "send-next-todo",
      name: "Naechstes offenes To-Do an den Agent senden",
      callback: () => this.sendNextTodo(),
    });

    this.addCommand({
      id: "ping",
      name: "Verbindung zu Herdr testen (ping)",
      callback: () => this.pingHerdr(),
    });

    this.addSettingTab(new HerdrSettingTab(this.app, this));
  }

  client(): HerdrClient {
    const sock = this.settings.socketPath.trim() || defaultSocketPath();
    return new HerdrClient(sock);
  }

  async pingHerdr() {
    try {
      const pong = await this.client().ping();
      new Notice(`Herdr OK: v${pong.version} (Protokoll ${pong.protocol})`);
    } catch (e) {
      new Notice(`Herdr nicht erreichbar: ${(e as Error).message}`);
    }
  }

  async sendNextTodo() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Keine aktive Notiz.");
      return;
    }

    const content = await this.app.vault.read(file);
    const todo = nextOpen(content);
    if (!todo) {
      new Notice("Alle To-Dos erledigt -- nichts zu senden.");
      return;
    }

    const explicit = this.frontmatterWorkspace(file);
    const noteBasename = file.basename;

    try {
      const client = this.client();
      const workspaces = await client.workspaces();
      const ws = resolveWorkspace(workspaces, noteBasename, explicit);

      if (!ws) {
        new Notice(
          `Kein Herdr-Workspace fuer "${explicit ?? noteBasename}" gefunden. ` +
            `Verfuegbar: ${workspaces.map((w) => w.label).join(", ")}`
        );
        return;
      }
      if (!ws.pane_id) {
        new Notice(`Workspace "${ws.label}" hat keinen Agent/Pane.`);
        return;
      }

      await client.sendToPane(ws.pane_id, todo.text, this.settings.submitWithEnter);
      new Notice(`-> ${ws.label}: "${todo.text}"`);
    } catch (e) {
      new Notice(`Senden fehlgeschlagen: ${(e as Error).message}`);
    }
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
      .setName("Mit Enter abschicken")
      .setDesc("Nach dem To-Do-Text automatisch Enter senden (Agent startet sofort).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.submitWithEnter).onChange(async (v) => {
          this.plugin.settings.submitWithEnter = v;
          await this.plugin.saveSettings();
        })
      );
  }
}

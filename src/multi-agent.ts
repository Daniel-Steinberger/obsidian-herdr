import { App, Modal, Setting, SuggestModal } from "obsidian";
import { TabView } from "./herdr-client";
import { DisplayState } from "./explorer-icons";
import { t } from "./i18n";

export type MultiAgentChoice = "single" | "sections" | "split";

/**
 * Dialog bei einem Space mit mehreren Agent-Tabs: bietet die drei Wege an
 * (ein Ziel-Tab / Sektionen im Dokument / Datei-Split). `openAndWait` liefert
 * die Wahl oder `null` (abgebrochen).
 */
export class MultiAgentChooserModal extends Modal {
  private choice: MultiAgentChoice | null = null;
  private settle: (c: MultiAgentChoice | null) => void = () => {};

  constructor(app: App, private spaceLabel: string, private tabCount: number) {
    super(app);
  }

  openAndWait(): Promise<MultiAgentChoice | null> {
    return new Promise((resolve) => {
      this.settle = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.titleEl.setText(t("ma.title", { name: this.spaceLabel }));
    this.contentEl.createEl("p", {
      text: t("ma.intro", { name: this.spaceLabel, count: this.tabCount }),
    });
    const pick = (c: MultiAgentChoice) => {
      this.choice = c;
      this.close();
    };
    new Setting(this.contentEl)
      .setName(t("ma.opt1.name"))
      .setDesc(t("ma.opt1.desc"))
      .addButton((b) => b.setCta().setButtonText(t("ma.opt1.btn")).onClick(() => pick("single")));
    new Setting(this.contentEl)
      .setName(t("ma.opt2.name"))
      .setDesc(t("ma.opt2.desc"))
      .addButton((b) => b.setButtonText(t("ma.opt2.btn")).onClick(() => pick("sections")));
    new Setting(this.contentEl)
      .setName(t("ma.opt3.name"))
      .setDesc(t("ma.opt3.desc"))
      .addButton((b) => b.setButtonText(t("ma.opt3.btn")).onClick(() => pick("split")));
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle(this.choice); // null wenn ohne Auswahl geschlossen
  }
}

/** Tab-Picker mit Status-Glyph; `openAndWait` liefert den Tab oder `null`. */
export class TabPickerModal extends SuggestModal<TabView> {
  private chosen: TabView | null = null;
  private settled = false;
  private settle: (t: TabView | null) => void = () => {};

  constructor(
    app: App,
    private tabs: TabView[],
    private glyph: (s: DisplayState) => string,
    private statusText: (s: DisplayState) => string,
    private toState: (s: string) => DisplayState
  ) {
    super(app);
    this.setPlaceholder(t("ma.pickTab"));
  }

  openAndWait(): Promise<TabView | null> {
    return new Promise((resolve) => {
      this.settle = (v) => {
        if (this.settled) return;
        this.settled = true;
        resolve(v);
      };
      this.open();
    });
  }

  getSuggestions(query: string): TabView[] {
    const q = query.toLowerCase();
    return this.tabs.filter((tb) =>
      `${tb.label} ${tb.agent ?? ""}`.toLowerCase().includes(q)
    );
  }

  renderSuggestion(tb: TabView, el: HTMLElement): void {
    const st = this.toState(tb.agent_status);
    el.createSpan({ text: this.glyph(st), cls: `herdr-explorer-icon herdr-st-${st}` });
    el.createSpan({ text: `  ${tb.label}` });
    el.createEl("small", { text: `   ${tb.agent ?? "?"} · ${this.statusText(st)}` });
  }

  onChooseSuggestion(tb: TabView): void {
    this.chosen = tb;
    this.settle(tb);
  }

  onClose(): void {
    super.onClose();
    this.settle(this.chosen); // null, falls ohne Auswahl geschlossen
  }
}

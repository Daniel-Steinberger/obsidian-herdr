import { App, TAbstractFile, TFile } from "obsidian";

/**
 * Blendet je Notiz im Datei-Explorer ein Status-Icon links vom Namen ein, das
 * den Herdr-Agent-Status spiegelt.
 *
 * ACHTUNG: Obsidian hat KEINE offizielle API dafuer. Der Zugriff auf die
 * File-Explorer-View (`getLeavesOfType("file-explorer")`, `view.fileItems` und
 * die DOM-Felder `titleEl`/`titleInnerEl`) ist undokumentiert und ungetypt --
 * daher lokale Interfaces + Cast + defensive Guards ueberall (fehlen die
 * Internals, macht die Klasse still nichts). Weil Obsidian Explorer-Eintraege
 * beim Auf-/Zuklappen/Scrollen neu rendert und dabei injizierte Elemente
 * verwirft, haelt ein MutationObserver die Icons nach.
 */

export type DisplayState = "idle" | "done" | "working" | "blocked" | "none";

/** Glyphen exakt wie Herdrs `agent_icon` (src/ui/status.rs). */
const GLYPH: Record<DisplayState, string> = {
  idle: "✓",
  done: "●",
  working: "●",
  blocked: "◉",
  none: "○",
};

const ICON_CLASS = "herdr-explorer-icon";

/**
 * Ungetypte Explorer-Internals, auf die wir defensiv zugreifen. Property-Namen
 * variieren je Obsidian-Version: aktuell `selfEl` (klickbare Zeile) +
 * `innerEl` (Text-Container); aeltere/andere Builds nutzen `titleEl` /
 * `titleInnerEl`. Wir akzeptieren beide.
 */
interface FileExplorerItem {
  selfEl?: HTMLElement;
  innerEl?: HTMLElement;
  titleEl?: HTMLElement;
  titleInnerEl?: HTMLElement;
  file?: TAbstractFile;
}
interface FileExplorerView {
  containerEl?: HTMLElement;
  fileItems?: Record<string, FileExplorerItem>;
}

export interface ExplorerCallbacks {
  /** Anzeige-Zustand fuer eine Notiz (Mapping + Herdr-Status). */
  getState(file: TFile): DisplayState;
  /** Liegt die Datei im Geltungsbereich (Herdr-Ordner)? */
  inScope(file: TFile): boolean;
  /** Ist das Feature eingeschaltet? */
  enabled(): boolean;
  /** Lokalisierter Tooltip-Text fuer einen Zustand. */
  label(state: DisplayState): string;
}

export class ExplorerDecorator {
  private observer: MutationObserver | null = null;
  private debounce: number | null = null;

  constructor(
    private readonly app: App,
    private readonly cb: ExplorerCallbacks
  ) {}

  /** Observer einhaengen und einmal anwenden. */
  start(): void {
    this.observe();
    this.apply();
  }

  /** Observer trennen und alle Icons entfernen. */
  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounce !== null) {
      window.clearTimeout(this.debounce);
      this.debounce = null;
    }
    this.clearAll();
  }

  /** Aktuelle File-Explorer-View, oder null wenn (noch) nicht vorhanden. */
  private view(): FileExplorerView | null {
    const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
    const view = leaf?.view as unknown as FileExplorerView | undefined;
    return view && view.fileItems ? view : null;
  }

  private observe(): void {
    const view = this.view();
    if (!view || !view.containerEl) return;
    const target =
      view.containerEl.querySelector(".nav-files-container") ?? view.containerEl;
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => this.scheduleApply());
    this.observer.observe(target, { childList: true, subtree: true });
  }

  private scheduleApply(): void {
    if (this.debounce !== null) return;
    this.debounce = window.setTimeout(() => {
      this.debounce = null;
      this.apply();
    }, 50);
  }

  /**
   * Icons fuer alle sichtbaren Eintraege setzen/aktualisieren. Idempotent:
   * schreibt nur bei tatsaechlicher Aenderung -> loest den eigenen Observer
   * nicht in einer Schleife aus.
   */
  apply(): void {
    if (!this.cb.enabled()) return;
    const view = this.view();
    if (!view || !view.fileItems) return;
    // Explorer kann erst nach start() erscheinen -> Observer nachziehen.
    if (!this.observer) this.observe();

    for (const path in view.fileItems) {
      const item = view.fileItems[path];
      const row = item?.selfEl ?? item?.titleEl; // klickbare Zeile
      if (!row) continue;
      const inner = item.innerEl ?? item.titleInnerEl; // Text-Container
      const file = item.file;
      const eligible =
        file instanceof TFile && file.extension === "md" && this.cb.inScope(file);
      if (!eligible) {
        this.removeIcon(row);
        continue;
      }
      this.setIcon(row, inner, this.cb.getState(file as TFile));
    }
  }

  private setIcon(
    row: HTMLElement,
    before: HTMLElement | undefined,
    state: DisplayState
  ): void {
    let icon = row.querySelector<HTMLElement>(`.${ICON_CLASS}`);
    if (!icon) {
      icon = document.createElement("span");
      icon.className = ICON_CLASS;
      if (before && before.parentElement === row) {
        row.insertBefore(icon, before); // links vom Namen
      } else {
        row.prepend(icon);
      }
    }
    const glyph = GLYPH[state];
    const cls = `${ICON_CLASS} herdr-st-${state}`;
    const label = this.cb.label(state);
    if (icon.textContent !== glyph) icon.textContent = glyph;
    if (icon.className !== cls) icon.className = cls;
    if (icon.getAttribute("aria-label") !== label) {
      icon.setAttribute("aria-label", label);
      icon.setAttribute("title", label);
    }
  }

  private removeIcon(row: HTMLElement): void {
    row.querySelector(`.${ICON_CLASS}`)?.remove();
  }

  /** Alle injizierten Icons entfernen (Toggle-Off / Unload). */
  clearAll(): void {
    const view = this.view();
    view?.containerEl
      ?.querySelectorAll(`.${ICON_CLASS}`)
      .forEach((el) => el.remove());
  }
}

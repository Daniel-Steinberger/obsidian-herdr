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
export const GLYPH: Record<DisplayState, string> = {
  idle: "✓",
  done: "●",
  working: "●",
  blocked: "◉",
  none: "○",
};

const ICON_CLASS = "herdr-explorer-icon";
const CONTAINER_CLASS = "herdr-explorer-icons";

/** Ein Icon einer Notiz: Zustand + optionales Label (Tab) fuer den Tooltip. */
export interface IconState {
  /** Stabiler Schluessel zur Wiederverwendung des DOM-Knotens (z.B. Tab-Label). */
  key: string;
  /** Tab-Label fuer den Tooltip; leer = nur Status anzeigen. */
  label: string;
  state: DisplayState;
}

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
  /**
   * Icons fuer eine Notiz: leer = kein Icon, 1 Element = Einzelziel,
   * mehrere = Sektions-Notiz (ein Icon je Tab).
   */
  getStates(file: TFile): IconState[];
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
        this.removeIcons(row);
        continue;
      }
      this.setIcons(row, inner, this.cb.getStates(file as TFile));
    }
  }

  /**
   * Setzt/aktualisiert die Icons einer Zeile aus `icons`. Ein Container-Span
   * haelt je `key` ein Kind-Span. Idempotent: schreibt/ordnet nur bei
   * tatsaechlicher Aenderung (sonst Observer-Schleife).
   */
  private setIcons(
    row: HTMLElement,
    before: HTMLElement | undefined,
    icons: IconState[]
  ): void {
    if (icons.length === 0) {
      this.removeIcons(row);
      return;
    }
    let container = row.querySelector<HTMLElement>(`.${CONTAINER_CLASS}`);
    if (!container) {
      container = document.createElement("span");
      container.className = CONTAINER_CLASS;
      if (before && before.parentElement === row) row.insertBefore(container, before);
      else row.prepend(container);
    }

    const existing = new Map<string, HTMLElement>();
    for (const el of Array.from(container.children)) {
      const key = (el as HTMLElement).dataset.herdrKey;
      if (key !== undefined) existing.set(key, el as HTMLElement);
    }
    const desired = new Set(icons.map((i) => i.key));
    for (const [key, el] of existing) {
      if (!desired.has(key)) {
        el.remove();
        existing.delete(key);
      }
    }
    for (const ic of icons) {
      let el = existing.get(ic.key);
      if (!el) {
        el = document.createElement("span");
        el.dataset.herdrKey = ic.key;
        container.appendChild(el);
        existing.set(ic.key, el);
      }
      const glyph = GLYPH[ic.state];
      const cls = `${ICON_CLASS} herdr-st-${ic.state}`;
      const status = this.cb.label(ic.state);
      const tip = ic.label ? `${ic.label}: ${status}` : status;
      if (el.textContent !== glyph) el.textContent = glyph;
      if (el.className !== cls) el.className = cls;
      if (el.getAttribute("title") !== tip) {
        el.setAttribute("title", tip);
        el.setAttribute("aria-label", tip);
      }
    }
    // Reihenfolge nur bei Abweichung angleichen.
    const order = Array.from(container.children).map((c) => (c as HTMLElement).dataset.herdrKey);
    const sameOrder = order.length === icons.length && order.every((k, i) => k === icons[i].key);
    if (!sameOrder) for (const ic of icons) container.appendChild(existing.get(ic.key)!);
  }

  private removeIcons(row: HTMLElement): void {
    row.querySelector(`.${CONTAINER_CLASS}`)?.remove();
  }

  /** Alle injizierten Icons entfernen (Toggle-Off / Unload). */
  clearAll(): void {
    const view = this.view();
    view?.containerEl
      ?.querySelectorAll(`.${CONTAINER_CLASS}`)
      .forEach((el) => el.remove());
  }
}

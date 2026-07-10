import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";

/**
 * Zeigt in Sektions-Notizen (`herdr-mode: sections`) ein Status-Icon direkt in
 * der Überschrift `# <space>.<tab>` an — live in der Bearbeitungsansicht (CM6).
 *
 * Der Status ist extern (Herdr-Poll), nicht aus dem Dokument ableitbar; deshalb
 * ein `StateEffect`, mit dem das Plugin nach jedem Poll ein Neuzeichnen anstoesst
 * (`refreshAllHeadingIcons`).
 */

export interface HeadingIcon {
  glyph: string;
  /** CSS-Klasse fuer die Farbe, z.B. "herdr-st-working". */
  cls: string;
  tip: string;
}

/** Liefert das Icon fuer eine Überschrift oder null (keine Sektions-Überschrift). */
export type HeadingResolver = (headingText: string) => HeadingIcon | null;

/** Effekt, der ein Neuzeichnen der Heading-Icons erzwingt. */
const refreshEffect = StateEffect.define<void>();

/** Aktive Editor-Views mit dieser Extension (fuer den Poll-getriebenen Refresh). */
const views = new Set<EditorView>();

/** Nach einem Status-Poll aufrufen: zeichnet die Heading-Icons neu. */
export function refreshAllHeadingIcons(): void {
  for (const view of views) view.dispatch({ effects: refreshEffect.of() });
}

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;

class IconWidget extends WidgetType {
  constructor(private readonly icon: HeadingIcon) {
    super();
  }
  eq(other: IconWidget): boolean {
    return (
      other.icon.glyph === this.icon.glyph &&
      other.icon.cls === this.icon.cls &&
      other.icon.tip === this.icon.tip
    );
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `herdr-explorer-icon herdr-heading-icon ${this.icon.cls}`;
    span.textContent = this.icon.glyph;
    span.setAttribute("title", this.icon.tip);
    span.setAttribute("aria-label", this.icon.tip);
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export function sectionHeadingIcons(resolve: HeadingResolver) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(private readonly view: EditorView) {
        views.add(view);
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate): void {
        const refresh = u.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshEffect))
        );
        if (u.docChanged || u.viewportChanged || refresh) {
          this.decorations = this.build(u.view);
        }
      }
      destroy(): void {
        views.delete(this.view);
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            const m = HEADING_RE.exec(line.text);
            if (m) {
              const icon = resolve(m[2]);
              if (icon) {
                builder.add(
                  line.to,
                  line.to,
                  Decoration.widget({ widget: new IconWidget(icon), side: 1 })
                );
              }
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}

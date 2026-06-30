/** Markdown-Checklisten parsen und abhaken. Port des Python-PoC. */

export interface TodoItem {
  /** 0-basierte Zeilennummer in der Datei. */
  lineNo: number;
  text: string;
  done: boolean;
}

// "- [ ] text" / "* [x] text", mit beliebiger Einrueckung.
const CHECKBOX_RE = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*\S)\s*$/;

export function parseTodos(content: string): TodoItem[] {
  const items: TodoItem[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = CHECKBOX_RE.exec(lines[i]);
    if (m) {
      items.push({ lineNo: i, text: m[3], done: m[2].toLowerCase() === "x" });
    }
  }
  return items;
}

export function nextOpen(content: string): TodoItem | null {
  return parseTodos(content).find((t) => !t.done) ?? null;
}

/** Liefert den Dateiinhalt mit der Checkbox in `lineNo` auf [x] gesetzt. */
export function markDone(content: string, lineNo: number): string {
  const lines = content.split("\n");
  const m = CHECKBOX_RE.exec(lines[lineNo] ?? "");
  if (!m) return content; // keine Checkbox -> unveraendert
  lines[lineNo] = `${m[1]}[x] ${m[3]}`;
  return lines.join("\n");
}

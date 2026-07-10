/** Markdown-Checklisten parsen und abhaken. Port des Python-PoC. */

export interface TodoItem {
  /** 0-basierte Zeilennummer in der Datei. */
  lineNo: number;
  text: string;
  done: boolean;
  /** Eingerueckter Freitext/Unterpunkte unter der Checkbox (ohne eigene Checkboxen). */
  context?: string;
}

// "- [ ] text" / "* [x] text", mit beliebiger Einrueckung.
const CHECKBOX_RE = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*\S)\s*$/;

function indentLength(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Sammelt Folgezeilen unter einer Checkbox als Kontext ein: Freitext oder
 * Bullet-Punkte ohne eigene Checkbox, solange sie staerker eingerueckt sind
 * als die Checkbox-Zeile selbst. Eine eigene Checkbox (egal welche Tiefe)
 * beendet das Einsammeln, da sie als eigenstaendiges To-Do getrackt wird.
 */
function collectContext(lines: string[], checkboxLineNo: number): string | undefined {
  const checkboxIndent = indentLength(lines[checkboxLineNo]);
  const contextLines: string[] = [];
  for (let j = checkboxLineNo + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === "") break;
    if (CHECKBOX_RE.test(line)) break;
    if (indentLength(line) <= checkboxIndent) break;
    contextLines.push(line.trim());
  }
  return contextLines.length > 0 ? contextLines.join("\n") : undefined;
}

export function parseTodos(content: string): TodoItem[] {
  const items: TodoItem[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = CHECKBOX_RE.exec(lines[i]);
    if (m) {
      items.push({
        lineNo: i,
        text: m[3],
        done: m[2].toLowerCase() === "x",
        context: collectContext(lines, i),
      });
    }
  }
  return items;
}

/** Text + eingesammelter Kontext, so wie es an den Agent gesendet werden soll. */
export function withContext(todo: TodoItem): string {
  return todo.context ? `${todo.text}\n${todo.context}` : todo.text;
}

export function nextOpen(content: string): TodoItem | null {
  return parseTodos(content).find((t) => !t.done) ?? null;
}

/** Eine Sektion `# <space>.<tab>` mit ihren To-Dos (Option 2). */
export interface Section {
  heading: string;
  /** Teil hinter `<space>.` — Tab-Label oder -Nummer. */
  tabToken: string;
  headingLine: number;
  todos: TodoItem[];
}

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;

/**
 * Zerlegt den Inhalt in Sektionen, deren Überschrift dem Muster
 * `<space>.<tab>` folgt. To-Dos werden der zuletzt gesehenen passenden Sektion
 * zugeordnet; eine nicht passende Überschrift beendet die aktuelle Sektion
 * (To-Dos davor/dazwischen ohne Sektion werden ignoriert).
 */
export function parseSections(content: string, space: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  const prefix = space + ".";
  let current: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    const hm = HEADING_RE.exec(lines[i]);
    if (hm) {
      const text = hm[2];
      if (text.startsWith(prefix) && text.length > prefix.length) {
        current = { heading: text, tabToken: text.slice(prefix.length), headingLine: i, todos: [] };
        sections.push(current);
      } else {
        current = null; // fremde Überschrift beendet die Sektion
      }
      continue;
    }
    const cm = CHECKBOX_RE.exec(lines[i]);
    if (cm && current) {
      current.todos.push({
        lineNo: i,
        text: cm[3],
        done: cm[2].toLowerCase() === "x",
        context: collectContext(lines, i),
      });
    }
  }
  return sections;
}

/** Liefert den Dateiinhalt mit der Checkbox in `lineNo` auf [x] gesetzt. */
export function markDone(content: string, lineNo: number): string {
  const lines = content.split("\n");
  const m = CHECKBOX_RE.exec(lines[lineNo] ?? "");
  if (!m) return content; // keine Checkbox -> unveraendert
  lines[lineNo] = `${m[1]}[x] ${m[3]}`;
  return lines.join("\n");
}

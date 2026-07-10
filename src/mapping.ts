import { TabView, WorkspaceView } from "./herdr-client";

/**
 * Ordnet eine Notiz einem Herdr-Workspace zu.
 *
 * Reihenfolge:
 *   1. Expliziter Hinweis (z.B. aus Frontmatter `herdr-workspace:`) -- matcht
 *      workspace_id, Label oder cwd-Basename.
 *   2. Notiz-Basename (Dateiname ohne .md) gegen Label oder cwd-Basename.
 */
export function resolveWorkspace(
  workspaces: WorkspaceView[],
  noteBasename: string,
  explicit?: string | null
): WorkspaceView | null {
  const needles = [explicit, noteBasename].filter(
    (n): n is string => typeof n === "string" && n.length > 0
  );

  for (const needle of needles) {
    const byId = workspaces.find((w) => w.workspace_id === needle);
    if (byId) return byId;
    const byLabel = workspaces.find((w) => w.label === needle);
    if (byLabel) return byLabel;
    const byCwd = workspaces.find(
      (w) => w.cwd && basename(w.cwd) === needle
    );
    if (byCwd) return byCwd;
  }
  return null;
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? p;
}

/**
 * Loest einen Tab-Hinweis (Label oder Nummer) gegen die Tabs eines Space auf.
 * Reihenfolge: erst Label-Gleichheit, dann Tab-Nummer (Default-Label = Nummer).
 */
export function resolveTab(tabs: TabView[], hint: string): TabView | null {
  const needle = hint.trim();
  if (!needle) return null;
  return (
    tabs.find((t) => t.label === needle) ??
    tabs.find((t) => String(t.number) === needle) ??
    null
  );
}

/**
 * Zerlegt einen Notiz-Basename in Space + optionalen Tab-Suffix `<space>.<tab>`.
 * Nur der LETZTE Punkt-Abschnitt gilt als moeglicher Tab; ob er wirklich ein Tab
 * ist, entscheidet erst `resolveTab` gegen die realen Tabs (deshalb wird beim
 * Aufloesen zuerst der volle Basename als Space probiert). Kein Suffix -> tab null.
 */
export function parseSpaceTab(basename: string): { space: string; tab: string | null } {
  const m = /^(.*)\.([^.]+)$/.exec(basename);
  if (!m || m[1].length === 0) return { space: basename, tab: null };
  return { space: m[1], tab: m[2] };
}

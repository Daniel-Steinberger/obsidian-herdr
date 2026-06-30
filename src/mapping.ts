import { WorkspaceView } from "./herdr-client";

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

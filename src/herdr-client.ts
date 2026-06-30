import * as net from "net";
import * as os from "os";
import * as path from "path";

/**
 * Minimaler Client fuer die Herdr-Unix-Socket-API.
 *
 * Protokoll (live verifiziert): line-delimited JSON ueber einen Unix-Domain-Socket.
 * Request:  {"id": "...", "method": "...", "params": {...}}\n
 * Response: {"id": "...", "result": {...}}\n  (oder {"error": {...}})
 *
 * Fuer einfache Aufrufe wird eine Verbindung pro Request geoeffnet -- das ist
 * das robusteste Muster (siehe Python-PoC). Streaming (events.subscribe) kommt
 * spaeter mit einer dauerhaft offenen Verbindung.
 */

export interface AgentInfo {
  terminal_id: string;
  agent?: string;
  agent_status: string;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  focused: boolean;
  cwd?: string;
  foreground_cwd?: string;
}

export interface WorkspaceInfo {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  agent_status: string;
  active_tab_id?: string;
}

/** Workspace angereichert um pane_id/cwd aus agent.list. */
export interface WorkspaceView extends WorkspaceInfo {
  pane_id?: string;
  cwd?: string;
  agent?: string;
}

export function defaultSocketPath(): string {
  const override = process.env.HERDR_SOCKET_PATH;
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), ".config", "herdr", "herdr.sock");
}

export class HerdrError extends Error {}

export class HerdrClient {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs = 5000
  ) {}

  /** Einzelner Request/Response ueber eine frische Verbindung. */
  call<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = Math.random().toString(36).slice(2, 10);
    const payload = JSON.stringify({ id, method, params }) + "\n";

    return new Promise<T>((resolve, reject) => {
      const sock = net.connect(this.socketPath);
      let buf = "";
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        sock.removeAllListeners();
        sock.destroy();
        fn();
      };

      sock.setEncoding("utf8");
      sock.setTimeout(this.timeoutMs, () =>
        finish(() => reject(new HerdrError(`Timeout bei ${method}`)))
      );
      sock.on("connect", () => sock.write(payload));
      sock.on("error", (err) =>
        finish(() =>
          reject(
            new HerdrError(
              `Verbindung zu Herdr fehlgeschlagen (${this.socketPath}): ${err.message}`
            )
          )
        )
      );
      sock.on("data", (chunk: string) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl < 0) return; // Zeile noch nicht vollstaendig
        const line = buf.slice(0, nl).trim();
        finish(() => {
          try {
            const resp = JSON.parse(line);
            if (resp.error) {
              const e = resp.error;
              reject(new HerdrError(`${method}: ${e.code ?? "error"} - ${e.message ?? ""}`));
            } else {
              resolve(resp.result as T);
            }
          } catch (e) {
            reject(new HerdrError(`Ungueltige Antwort auf ${method}: ${line}`));
          }
        });
      });
    });
  }

  async ping(): Promise<{ version: string; protocol: number }> {
    return this.call("ping");
  }

  /** workspace.list + agent.list joinen, damit jeder Workspace pane_id/cwd hat. */
  async workspaces(): Promise<WorkspaceView[]> {
    const wsRes = await this.call<{ workspaces: WorkspaceInfo[] }>("workspace.list");
    const agRes = await this.call<{ agents: AgentInfo[] }>("agent.list");
    const byWs = new Map<string, AgentInfo>();
    for (const a of agRes.agents ?? []) {
      if (!byWs.has(a.workspace_id)) byWs.set(a.workspace_id, a);
    }
    return (wsRes.workspaces ?? []).map((w) => {
      const a = byWs.get(w.workspace_id);
      return { ...w, pane_id: a?.pane_id, cwd: a?.cwd, agent: a?.agent };
    });
  }

  /**
   * Literaltext in einen Pane schreiben, optional mit Enter abschicken.
   *
   * Nutzt `pane.send_input` (Text + Keys in EINEM atomaren Request) statt
   * `send_text` + separatem `send_keys`. Wichtig: `send_input` umschliesst den
   * Text serverseitig mit Bracketed-Paste-Markern (\e[200~ ... \e[201~), wenn
   * der Agent Bracketed-Paste aktiv hat, und schreibt das Enter garantiert NACH
   * dem End-Marker. Damit landet das Enter ausserhalb des Pastes (echtes
   * Submit) statt als Zeilenumbruch im Eingabefeld zu versickern — das Race der
   * frueheren Zwei-Request-Variante entfaellt.
   */
  async sendToPane(paneId: string, text: string, submit = true): Promise<void> {
    await this.call("pane.send_input", {
      pane_id: paneId,
      text,
      keys: submit ? ["Enter"] : [],
    });
  }

  /**
   * Nur ein Enter an den Pane senden (kein Text) — fuer die Submit-Absicherung:
   * Wenn das mit dem Paste gebuendelte Enter verschluckt wurde und der Text
   * unabgeschickt im Eingabefeld steht, holt ein spaeteres, separates Enter das
   * Abschicken nach (`pane.send_input` mit leerem Text laesst diesen weg).
   */
  async submit(paneId: string): Promise<void> {
    await this.call("pane.send_input", { pane_id: paneId, keys: ["Enter"] });
  }
}

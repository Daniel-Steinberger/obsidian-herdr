import { spawn, ChildProcess } from "child_process";

/**
 * Blockierendes Warten auf einen Agent-Status -- delegiert an Herdrs eigenen,
 * erprobten CLI (`herdr agent wait`).
 *
 * Hintergrund: Der rohe `events.subscribe`-Stream ueber den Socket war in der
 * installierten v0.7.1 unzuverlaessig (Status-Events kamen nicht an), waehrend
 * `herdr agent wait` zuverlaessig funktioniert. Statt die Subscribe-Schleife
 * nachzubauen, nutzen wir Herdrs getesteten Client.
 *
 * rc 0  -> Status erreicht ("matched")
 * rc !=0 -> Timeout / Stream geschlossen ("timeout")
 * spawn-Fehler (z.B. herdr nicht im PATH) -> "error"
 */

export type WaitStatus = "idle" | "working" | "blocked" | "unknown";
export type WaitResult = "matched" | "timeout" | "error";

export interface WaitHandle {
  promise: Promise<WaitResult>;
  cancel: () => void;
}

export function waitForStatus(
  herdrPath: string,
  paneId: string,
  status: WaitStatus,
  timeoutMs: number,
  socketPath?: string
): WaitHandle {
  let child: ChildProcess | null = null;
  let cancelled = false;

  const promise = new Promise<WaitResult>((resolve) => {
    const env = { ...process.env };
    if (socketPath && socketPath.trim().length > 0) {
      env.HERDR_SOCKET_PATH = socketPath.trim();
    }

    let settled = false;
    const done = (r: WaitResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    try {
      child = spawn(
        herdrPath,
        ["agent", "wait", paneId, "--status", status, "--timeout", String(timeoutMs)],
        { env }
      );
    } catch {
      done("error");
      return;
    }

    child.on("error", () => done("error"));
    child.on("close", (code) => {
      if (cancelled) return done("error");
      done(code === 0 ? "matched" : "timeout");
    });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (child) child.kill();
    },
  };
}

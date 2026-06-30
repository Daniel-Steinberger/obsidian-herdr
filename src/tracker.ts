import { App, Notice, TFile } from "obsidian";
import { waitForStatus, WaitHandle } from "./agent-wait";
import { markDone, parseTodos } from "./todos";
import { t } from "./i18n";

export interface TrackOptions {
  herdrPath: string;
  socketPath?: string;
  /** Max. Wartezeit auf Arbeitsbeginn (working) in ms. */
  workingTimeoutMs: number;
  /** Max. Wartezeit auf Fertigstellung (idle) in ms. */
  idleTimeoutMs: number;
  /**
   * Submit-Absicherung: Enter erneut senden, wenn der Agent nach dem Senden
   * nicht zu arbeiten beginnt (Text steht unabgeschickt im Eingabefeld).
   * Fehlt der Callback, ist die Absicherung aus (Verhalten wie zuvor).
   */
  resubmit?: () => Promise<void>;
  /** Intervall je „beginnt der Agent zu arbeiten?"-Probe in ms (Default 2000). */
  submitProbeMs?: number;
}

interface Entry {
  cancelled: boolean;
  handle: WaitHandle | null;
  filePath: string;
  lineNo: number;
  text: string;
  onComplete?: (marked: boolean) => void;
}

/**
 * Verfolgt gesendete To-Dos und hakt die Checkbox ab, sobald der Agent fertig ist.
 *
 * Heuristik "Agent fertig" (an v0.7.1 angepasst -- dort gibt es nur
 * idle/working/blocked/unknown, kein "done"):
 *   1. Auf `working` warten (sofern nicht schon working) -> Agent hat To-Do aufgenommen.
 *   2. Danach auf `idle` warten -> fertig -> Checkbox abhaken.
 * Geht der Schritt 1 in den Timeout (Agent begann nie erkennbar zu arbeiten),
 * wird NICHT automatisch abgehakt, um Fehlauslösungen zu vermeiden.
 */
export class CompletionTracker {
  private entries = new Map<string, Entry>(); // key: pane_id

  constructor(private app: App) {}

  track(
    paneId: string,
    file: TFile,
    lineNo: number,
    text: string,
    initialStatus: string,
    opts: TrackOptions,
    onComplete?: (marked: boolean) => void
  ): void {
    this.cancel(paneId); // ein neues To-Do fuer denselben Pane loest das alte ab
    const entry: Entry = {
      cancelled: false,
      handle: null,
      filePath: file.path,
      lineNo,
      text,
      onComplete,
    };
    this.entries.set(paneId, entry);
    void this.run(paneId, entry, initialStatus, opts);
  }

  private async run(
    paneId: string,
    entry: Entry,
    initialStatus: string,
    opts: TrackOptions
  ): Promise<void> {
    // Schritt 1: Arbeitsbeginn abwarten (falls Agent nicht schon arbeitet),
    // mit Submit-Absicherung: In kurzen Intervallen pruefen, ob der Agent zu
    // arbeiten beginnt. Tut er das nicht, steht der Text vermutlich
    // unabgeschickt im Eingabefeld -> Enter nachschicken und erneut pruefen.
    // Das wiederholt sich, bis der Agent EINMAL `working` war (= abgeschickt)
    // oder das Arbeitsbeginn-Zeitfenster (workingTimeoutMs) ablaeuft.
    if (initialStatus !== "working") {
      const canResubmit = !!opts.resubmit;
      const probeMs = canResubmit ? opts.submitProbeMs ?? 2000 : opts.workingTimeoutMs;
      let elapsed = 0;
      let resubmits = 0;
      let started = false;

      while (elapsed < opts.workingTimeoutMs) {
        const probe = Math.min(probeMs, opts.workingTimeoutMs - elapsed);
        entry.handle = waitForStatus(opts.herdrPath, paneId, "working", probe, opts.socketPath);
        const r = await entry.handle.promise;
        if (entry.cancelled) return;
        if (r === "matched") {
          started = true;
          break;
        }
        elapsed += probe;
        // Noch kein Arbeitsbeginn -> Enter nachschicken und weiter pruefen,
        // solange das Zeitfenster nicht abgelaufen ist (kein festes Limit).
        if (canResubmit && elapsed < opts.workingTimeoutMs) {
          resubmits++;
          try {
            await opts.resubmit!();
            new Notice(t("notice.resent", { n: resubmits }));
          } catch {
            /* Senden fehlgeschlagen -> weiter pruefen, naechster Versuch */
          }
        }
      }

      if (!started) {
        this.entries.delete(paneId);
        new Notice(t("notice.noWorkStart", { text: entry.text }));
        entry.onComplete?.(false);
        return;
      }
    }

    // Schritt 2: Fertigstellung (idle) abwarten.
    entry.handle = waitForStatus(
      opts.herdrPath,
      paneId,
      "idle",
      opts.idleTimeoutMs,
      opts.socketPath
    );
    const r2 = await entry.handle.promise;
    if (entry.cancelled) return;
    this.entries.delete(paneId);

    if (r2 !== "matched") {
      new Notice(t("notice.idleTimeout", { text: entry.text }));
      entry.onComplete?.(false);
      return;
    }
    await this.complete(entry);
    entry.onComplete?.(true);
  }

  private async complete(entry: Entry): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.read(file);
    const lineNo = this.locateLine(content, entry.lineNo, entry.text);
    if (lineNo == null) return; // schon abgehakt, verschoben oder entfernt
    await this.app.vault.modify(file, markDone(content, lineNo));
    new Notice(t("notice.checked", { text: entry.text }));
  }

  /** Robuste Zeilensuche: bevorzugt gespeicherte Zeile, sonst nach Text. */
  private locateLine(content: string, lineNo: number, text: string): number | null {
    const todos = parseTodos(content);
    const exact = todos.find((t) => t.lineNo === lineNo && t.text === text && !t.done);
    if (exact) return exact.lineNo;
    const byText = todos.find((t) => t.text === text && !t.done);
    return byText ? byText.lineNo : null;
  }

  cancel(paneId: string): void {
    const e = this.entries.get(paneId);
    if (e) {
      e.cancelled = true;
      e.handle?.cancel();
      this.entries.delete(paneId);
    }
  }

  stopAll(): void {
    for (const e of this.entries.values()) {
      e.cancelled = true;
      e.handle?.cancel();
    }
    this.entries.clear();
  }
}

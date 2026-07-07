/**
 * Minimale Internationalisierung fuer das Plugin.
 *
 * Obsidian hat keine offizielle i18n-API fuer Plugins. Die eingestellte
 * Oberflaechensprache liegt in `localStorage["language"]` (leer/null = Englisch,
 * sonst ein Sprachcode wie "de", "fr", "zh"). Wir lesen sie und waehlen das
 * passende Dictionary; fehlt eine Sprache oder ein Schluessel, faellt alles auf
 * Englisch zurueck.
 *
 * Neue Sprache hinzufuegen: Code in SUPPORTED ergaenzen und ein Dictionary mit
 * denselben Schluesseln wie `en` anlegen.
 */

export type Lang = "en" | "de";

const SUPPORTED: Lang[] = ["en", "de"];

/** Aktuelle Obsidian-Sprache; Fallback "en". */
export function currentLang(): Lang {
  let code = "";
  try {
    code = window.localStorage.getItem("language") || "";
  } catch {
    /* localStorage nicht verfuegbar -> Englisch */
  }
  const base = code.split("-")[0].toLowerCase();
  return (SUPPORTED as string[]).includes(base) ? (base as Lang) : "en";
}

type Dict = Record<string, string>;

const en: Dict = {
  // Commands
  "cmd.sendNext": "Send next open to-do to the agent",
  "cmd.startContinuous": "Start continuous mode for this note",
  "cmd.stopContinuous": "Stop continuous mode",
  "cmd.ping": "Test connection to Herdr (ping)",

  // Status bar
  "sb.running": "Herdr: running ({count})",
  "sb.open": "Herdr: {count} open",
  "sb.tip.step": "Send next to-do to the agent",
  "sb.tip.stop": "Stop continuous mode",
  "sb.tip.all": "Work through all to-dos continuously",

  // Folder context menu
  "menu.spaceNote": "Herdr: note for space",
  "menu.noSpaces": "No Herdr spaces (is Herdr running?)",

  // Notices
  "notice.herdrOk": "Herdr OK: v{version} (protocol {protocol})",
  "notice.herdrUnreachable": "Herdr unreachable: {error}",
  "notice.noActiveNote": "No active note.",
  "notice.continuousNeedsEnter": "Continuous mode requires 'Submit with Enter'.",
  "notice.continuousAlreadyRunning": "Continuous mode already running for \"{name}\".",
  "notice.continuousStarted": "Continuous mode started: \"{name}\"",
  "notice.continuousStopped": "Continuous mode stopped: \"{name}\"",
  "notice.allContinuousStopped": "All continuous modes stopped.",
  "notice.noContinuous": "No continuous mode active.",
  "notice.continuousPaused": "Continuous mode paused (timeout / no work start): \"{name}\"",
  "notice.notInFolder": "\"{name}\" is not in the Herdr folder (\"{folder}\").",
  "notice.allDoneNothing": "All to-dos done -- nothing to send.",
  "notice.allDoneContinuous": "All to-dos done -- continuous mode finished: \"{name}\"",
  "notice.noWorkspace": "No Herdr workspace found for \"{name}\". Available: {available}",
  "notice.noPane": "Workspace \"{label}\" has no agent/pane.",
  "notice.sentContinuous": "-> {label}: \"{text}\" [continuous]",
  "notice.sentTracking": "-> {label}: \"{text}\" (checked off when done)",
  "notice.sent": "-> {label}: \"{text}\"",
  "notice.sendFailed": "Sending failed: {error}",
  "notice.resent": "No work start -- Enter sent again (#{n}).",
  "notice.noWorkStart": "Auto-check: work start for \"{text}\" not detected.",
  "notice.idleTimeout": "Auto-check: timeout while waiting for \"{text}\".",
  "notice.checked": "Checked off: \"{text}\"",
  "notice.noteCreated": "Note for space \"{label}\" created: {name}",
  "notice.noteOpened": "Opened: {name}",
  "notice.noteCreateFailed": "Could not create note: {error}",

  // Settings
  "set.folder.name": "Herdr folder",
  "set.folder.desc":
    "Vault-relative folder the plugin watches (e.g. 'herdr' or 'projects/herdr'). " +
    "A note's file name inside it stands for the workspace. Empty = whole vault.",
  "set.socket.name": "Socket path",
  "set.socket.desc":
    "Path to the Herdr API socket. Empty = default ($HERDR_SOCKET_PATH or ~/.config/herdr/herdr.sock).",
  "set.herdrPath.name": "herdr program path",
  "set.herdrPath.desc":
    "Path to the herdr binary for auto-checking (uses `herdr agent wait`). " +
    "Empty = `herdr` from PATH. If Obsidian doesn't know the PATH, enter the full path (e.g. ~/.local/bin/herdr).",
  "set.submitEnter.name": "Submit with Enter",
  "set.submitEnter.desc": "Automatically send Enter after the to-do text (agent starts immediately).",
  "set.autoCheck.name": "Auto-check",
  "set.autoCheck.desc":
    "Check the box once the agent is done after sending (working -> idle). Requires 'Submit with Enter'.",
  "set.workingTimeout.name": "Work-start timeout (seconds)",
  "set.workingTimeout.desc":
    "How long to wait for the switch to 'working' before auto-check gives up.",
  "set.idleTimeout.name": "Completion timeout (minutes)",
  "set.idleTimeout.desc": "Maximum wait for 'idle' (agent done) before auto-check gives up.",
};

const de: Dict = {
  // Commands
  "cmd.sendNext": "Nächstes offenes To-Do an den Agent senden",
  "cmd.startContinuous": "Kontinuierlichen Modus für diese Notiz starten",
  "cmd.stopContinuous": "Kontinuierlichen Modus stoppen",
  "cmd.ping": "Verbindung zu Herdr testen (ping)",

  // Statusleiste
  "sb.running": "Herdr: läuft ({count})",
  "sb.open": "Herdr: {count} offen",
  "sb.tip.step": "Nächstes To-Do an den Agent senden",
  "sb.tip.stop": "Kontinuierlichen Modus stoppen",
  "sb.tip.all": "Alle To-Dos kontinuierlich abarbeiten",

  // Ordner-Kontextmenü
  "menu.spaceNote": "Herdr: Notiz für Space",
  "menu.noSpaces": "Keine Herdr-Spaces (läuft Herdr?)",

  // Hinweise
  "notice.herdrOk": "Herdr OK: v{version} (Protokoll {protocol})",
  "notice.herdrUnreachable": "Herdr nicht erreichbar: {error}",
  "notice.noActiveNote": "Keine aktive Notiz.",
  "notice.continuousNeedsEnter": "Kontinuierlicher Modus benötigt 'Mit Enter abschicken'.",
  "notice.continuousAlreadyRunning": "Kontinuierlicher Modus läuft bereits für \"{name}\".",
  "notice.continuousStarted": "Kontinuierlicher Modus gestartet: \"{name}\"",
  "notice.continuousStopped": "Kontinuierlicher Modus gestoppt: \"{name}\"",
  "notice.allContinuousStopped": "Alle kontinuierlichen Modi gestoppt.",
  "notice.noContinuous": "Kein kontinuierlicher Modus aktiv.",
  "notice.continuousPaused": "Kontinuierlicher Modus angehalten (Timeout/kein Arbeitsbeginn): \"{name}\"",
  "notice.notInFolder": "\"{name}\" liegt nicht im Herdr-Ordner (\"{folder}\").",
  "notice.allDoneNothing": "Alle To-Dos erledigt -- nichts zu senden.",
  "notice.allDoneContinuous": "Alle To-Dos erledigt -- kontinuierlicher Modus beendet: \"{name}\"",
  "notice.noWorkspace": "Kein Herdr-Workspace für \"{name}\" gefunden. Verfügbar: {available}",
  "notice.noPane": "Workspace \"{label}\" hat keinen Agent/Pane.",
  "notice.sentContinuous": "-> {label}: \"{text}\" [kontinuierlich]",
  "notice.sentTracking": "-> {label}: \"{text}\" (wird abgehakt, wenn fertig)",
  "notice.sent": "-> {label}: \"{text}\"",
  "notice.sendFailed": "Senden fehlgeschlagen: {error}",
  "notice.resent": "Kein Arbeitsbeginn -- Enter erneut gesendet (#{n}).",
  "notice.noWorkStart": "Auto-Abhaken: Arbeitsbeginn für \"{text}\" nicht erkannt.",
  "notice.idleTimeout": "Auto-Abhaken: Timeout beim Warten auf \"{text}\".",
  "notice.checked": "Abgehakt: \"{text}\"",
  "notice.noteCreated": "Notiz für Space \"{label}\" angelegt: {name}",
  "notice.noteOpened": "Geöffnet: {name}",
  "notice.noteCreateFailed": "Notiz konnte nicht angelegt werden: {error}",

  // Einstellungen
  "set.folder.name": "Herdr-Ordner",
  "set.folder.desc":
    "Vault-relativer Ordner, den das Plugin beachtet (z.B. 'herdr' oder 'projekte/herdr'). " +
    "Der Dateiname einer Notiz darin steht für den Workspace. Leer = ganzer Vault.",
  "set.socket.name": "Socket-Pfad",
  "set.socket.desc":
    "Pfad zum Herdr-API-Socket. Leer = Standard ($HERDR_SOCKET_PATH oder ~/.config/herdr/herdr.sock).",
  "set.herdrPath.name": "herdr-Programmpfad",
  "set.herdrPath.desc":
    "Pfad zum herdr-Binary für das Auto-Abhaken (nutzt `herdr agent wait`). " +
    "Leer = `herdr` aus dem PATH. Falls Obsidian den PATH nicht kennt, vollen Pfad eintragen (z.B. ~/.local/bin/herdr).",
  "set.submitEnter.name": "Mit Enter abschicken",
  "set.submitEnter.desc": "Nach dem To-Do-Text automatisch Enter senden (Agent startet sofort).",
  "set.autoCheck.name": "Automatisch abhaken",
  "set.autoCheck.desc":
    "Checkbox abhaken, sobald der Agent nach dem Senden fertig ist (working -> idle). Benötigt 'Mit Enter abschicken'.",
  "set.workingTimeout.name": "Timeout Arbeitsbeginn (Sekunden)",
  "set.workingTimeout.desc":
    "Wie lange auf den Wechsel zu 'working' gewartet wird, bevor das Auto-Abhaken aufgibt.",
  "set.idleTimeout.name": "Timeout Fertigstellung (Minuten)",
  "set.idleTimeout.desc": "Maximale Wartezeit auf 'idle' (Agent fertig), bevor das Auto-Abhaken aufgibt.",
};

const DICTS: Record<Lang, Dict> = { en, de };

/**
 * Uebersetzt `key` in die aktuelle Sprache und ersetzt `{name}`-Platzhalter
 * durch `params`. Unbekannter Schluessel/fehlende Sprache -> Englisch -> key.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = currentLang();
  const template = DICTS[lang]?.[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in params ? String(params[k]) : `{${k}}`
  );
}

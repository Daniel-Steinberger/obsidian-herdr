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
  "cmd.configureMulti": "Configure multi-agent handling for this note",
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

  // Explorer status icons (tooltips)
  "status.idle": "idle",
  "status.done": "done",
  "status.working": "working",
  "status.blocked": "blocked",
  "status.none": "no agent",

  // Multi-agent chooser
  "ma.title": "Multiple agents in \"{name}\"",
  "ma.intro": "The space \"{name}\" has {count} agent tabs. How should this note target them?",
  "ma.opt1.name": "Send to one tab",
  "ma.opt1.desc": "Pick a single tab; this note always targets it (stored as herdr-tab).",
  "ma.opt1.btn": "Pick tab…",
  "ma.opt2.name": "Sections in this note",
  "ma.opt2.desc": "Add a heading per tab; to-dos under each heading go to that tab. Existing to-dos move under the first section.",
  "ma.opt2.btn": "Create sections",
  "ma.opt3.name": "Split into files",
  "ma.opt3.desc": "Rename this note to <space>.<tab1> and create an empty note per further tab.",
  "ma.opt3.btn": "Split files",
  "ma.pickTab": "Pick a tab (label or number)…",

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
  "notice.sectionAllDone": "This section has no open to-do.",
  "notice.allDoneContinuous": "All to-dos done -- continuous mode finished: \"{name}\"",
  "notice.noWorkspace": "No Herdr workspace found for \"{name}\". Available: {available}",
  "notice.noPane": "Workspace \"{label}\" has no agent/pane.",
  "notice.tabNotFound": "Workspace \"{label}\" has no tab \"{tab}\".",
  "notice.sentContinuous": "-> {label}: \"{text}\" [continuous]",
  "notice.sentTracking": "-> {label}: \"{text}\" (checked off when done)",
  "notice.sent": "-> {label}: \"{text}\"",
  "notice.sendFailed": "Sending failed: {error}",
  "notice.resent": "No work start -- Enter sent again (#{n}).",
  "notice.noWorkStart": "Auto-check: work start for \"{text}\" not detected.",
  "notice.idleTimeout": "Auto-check: timeout while waiting for \"{text}\".",
  "notice.checked": "Checked off: \"{text}\"",
  "notice.tabChosen": "This note now targets tab {label}.",
  "notice.splitDone": "Split into {count} tab notes: \"{name}\"",
  "notice.sectionsDone": "Added {count} sections to \"{name}\".",
  "notice.singleAgent": "Workspace \"{label}\" has fewer than two agent tabs.",
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
  "set.explorerIcons.name": "Agent status icons in the file explorer",
  "set.explorerIcons.desc":
    "Show a Herdr agent-status icon left of each note in the Herdr folder " +
    "(idle / done / working / blocked / no agent), mirroring Herdr's own display.",
  "set.explorerPoll.name": "Status refresh interval (seconds)",
  "set.explorerPoll.desc":
    "How often the agent status is polled from Herdr for the explorer icons. " +
    "Takes effect after reloading the plugin.",
};

const de: Dict = {
  // Commands
  "cmd.sendNext": "Nächstes offenes To-Do an den Agent senden",
  "cmd.startContinuous": "Kontinuierlichen Modus für diese Notiz starten",
  "cmd.stopContinuous": "Kontinuierlichen Modus stoppen",
  "cmd.configureMulti": "Multi-Agent-Handhabung für diese Notiz festlegen",
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

  // Explorer-Status-Icons (Tooltips)
  "status.idle": "idle",
  "status.done": "done",
  "status.working": "working",
  "status.blocked": "blocked",
  "status.none": "kein Agent",

  // Multi-Agent-Auswahl
  "ma.title": "Mehrere Agents in \"{name}\"",
  "ma.intro": "Der Space \"{name}\" hat {count} Agent-Tabs. Wie soll diese Notiz sie ansteuern?",
  "ma.opt1.name": "An einen Tab senden",
  "ma.opt1.desc": "Einen Tab wählen; die Notiz zielt immer darauf (gespeichert als herdr-tab).",
  "ma.opt1.btn": "Tab wählen…",
  "ma.opt2.name": "Sektionen in dieser Notiz",
  "ma.opt2.desc": "Je Tab eine Überschrift; To-Dos darunter gehen an den jeweiligen Tab. Bestehende To-Dos wandern unter die erste Sektion.",
  "ma.opt2.btn": "Sektionen anlegen",
  "ma.opt3.name": "In Dateien aufteilen",
  "ma.opt3.desc": "Diese Notiz zu <space>.<tab1> umbenennen und je weiterem Tab eine leere Notiz anlegen.",
  "ma.opt3.btn": "Dateien aufteilen",
  "ma.pickTab": "Tab wählen (Label oder Nummer)…",

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
  "notice.sectionAllDone": "Diese Sektion hat kein offenes To-Do.",
  "notice.allDoneContinuous": "Alle To-Dos erledigt -- kontinuierlicher Modus beendet: \"{name}\"",
  "notice.noWorkspace": "Kein Herdr-Workspace für \"{name}\" gefunden. Verfügbar: {available}",
  "notice.noPane": "Workspace \"{label}\" hat keinen Agent/Pane.",
  "notice.tabNotFound": "Workspace \"{label}\" hat keinen Tab \"{tab}\".",
  "notice.sentContinuous": "-> {label}: \"{text}\" [kontinuierlich]",
  "notice.sentTracking": "-> {label}: \"{text}\" (wird abgehakt, wenn fertig)",
  "notice.sent": "-> {label}: \"{text}\"",
  "notice.sendFailed": "Senden fehlgeschlagen: {error}",
  "notice.resent": "Kein Arbeitsbeginn -- Enter erneut gesendet (#{n}).",
  "notice.noWorkStart": "Auto-Abhaken: Arbeitsbeginn für \"{text}\" nicht erkannt.",
  "notice.idleTimeout": "Auto-Abhaken: Timeout beim Warten auf \"{text}\".",
  "notice.checked": "Abgehakt: \"{text}\"",
  "notice.tabChosen": "Diese Notiz zielt jetzt auf Tab {label}.",
  "notice.splitDone": "In {count} Tab-Notizen aufgeteilt: \"{name}\"",
  "notice.sectionsDone": "{count} Sektionen zu \"{name}\" hinzugefügt.",
  "notice.singleAgent": "Workspace \"{label}\" hat weniger als zwei Agent-Tabs.",
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
  "set.explorerIcons.name": "Agent-Status-Icons im Datei-Explorer",
  "set.explorerIcons.desc":
    "Zeigt links von jeder Notiz im Herdr-Ordner ein Herdr-Agent-Status-Icon " +
    "(idle / done / working / blocked / kein Agent), analog zu Herdrs eigener Darstellung.",
  "set.explorerPoll.name": "Aktualisierungsintervall (Sekunden)",
  "set.explorerPoll.desc":
    "Wie oft der Agent-Status für die Explorer-Icons aus Herdr abgefragt wird. " +
    "Wirkt nach dem Neuladen des Plugins.",
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

# Herdr Bridge (Obsidian-Plugin)

Verbindet Notizen-Checklisten in Obsidian mit Agents im
[Herdr](https://github.com/ogulcancelik/herdr)-Terminal-Multiplexer.

Workflow: Du fuehrst deine To-Dos pro Projekt als Markdown-Checkliste in einer
Notiz. Per Command schickt das Plugin das naechste offene To-Do an den Agent im
zugehoerigen Herdr-Workspace. Sobald der Agent fertig ist, wird die Checkbox
automatisch abgehakt.

## Wie es funktioniert

Obsidian Desktop laeuft auf Electron, daher kann das Plugin direkt den
Unix-Socket der Herdr-API ansprechen (line-delimited JSON) -- **kein separater
Daemon noetig**. Verwendete API-Methoden:

- `ping` -- Verbindungstest
- `workspace.list` + `agent.list` -- Workspaces inkl. `pane_id`/`cwd` ermitteln
- `pane.send_text` + `pane.send_keys` -- To-Do in den Agent-Pane schreiben

**Auto-Abhaken:** Hierfuer ruft das Plugin Herdrs eigenen, erprobten CLI auf
(`herdr agent wait <pane> --status ...`). Grund: der rohe `events.subscribe`-
Stream lieferte in der getesteten Herdr-Version v0.7.1 unzuverlaessig
Status-Events, waehrend `herdr agent wait` zuverlaessig funktioniert. Logik:
nach dem Senden auf `working` warten (Agent hat aufgenommen), danach auf `idle`
(fertig) -> Checkbox abhaken. Begann der Agent nie erkennbar zu arbeiten, wird
NICHT abgehakt.

## Notiz <-> Workspace Mapping

1. Frontmatter `herdr-workspace:` (matcht Workspace-ID, Label oder cwd-Basename)
2. sonst: Dateiname der Notiz gegen Label oder cwd-Basename

```markdown
---
herdr-workspace: herdr
---

## To-Dos
- [ ] Tests reparieren
- [ ] README aktualisieren
```

## Commands

- **Naechstes offenes To-Do an den Agent senden**
- **Verbindung zu Herdr testen (ping)**

## Einstellungen

- **Socket-Pfad** -- leer = `$HERDR_SOCKET_PATH` bzw. `~/.config/herdr/herdr.sock`
- **herdr-Programmpfad** -- fuer das Auto-Abhaken; leer = `herdr` aus dem PATH.
  Falls Obsidian den PATH nicht kennt, vollen Pfad eintragen (z.B. `~/.local/bin/herdr`).
- **Mit Enter abschicken** -- Enter nach dem Text senden
- **Automatisch abhaken** -- Checkbox abhaken, wenn der Agent fertig ist
- **Timeout Arbeitsbeginn / Fertigstellung** -- Wartegrenzen fuers Auto-Abhaken

## Build

```bash
npm install
npm run build      # erzeugt main.js
```

Zum Testen Plugin-Ordner (mit `manifest.json`, `main.js`) nach
`<Vault>/.obsidian/plugins/herdr-obsidian/` kopieren oder symlinken und in
Obsidian unter "Community-Plugins" aktivieren.

## Status

Funktioniert (live gegen Herdr v0.7.1 getestet): Sende-Command, Mapping,
Auto-Abhaken (working -> idle). Moegliche naechste Schritte: Statusanzeige in
der Statusbar, mehrere Agents pro Workspace unterscheiden, Command zum manuellen
Abhaken/Abbrechen einer laufenden Verfolgung.

`test/itest.ts` ist ein Integrationstest gegen einen laufenden Herdr-Server
(bundeln mit esbuild, dann mit node ausfuehren).

## Desktop-only

Nutzt Node-`net`/Unix-Sockets -- laeuft nur in Obsidian Desktop, nicht Mobile.
Bei entferntem Herdr muss der Socket lokal erreichbar sein (z.B. SSH-Forwarding).

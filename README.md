# Herdr Bridge (Obsidian-Plugin)

Verbindet Notizen-Checklisten in Obsidian mit Agents im
[Herdr](https://github.com/ogulcancelik/herdr)-Terminal-Multiplexer.

Workflow: Du fuehrst deine To-Dos pro Projekt als Markdown-Checkliste in einer
Notiz. Per Command schickt das Plugin das naechste offene To-Do an den Agent im
zugehoerigen Herdr-Workspace. (Geplant: automatisches Abhaken, sobald der Agent
fertig ist.)

## Wie es funktioniert

Obsidian Desktop laeuft auf Electron, daher kann das Plugin direkt den
Unix-Socket der Herdr-API ansprechen (line-delimited JSON) -- **kein separater
Daemon noetig**. Verwendete API-Methoden:

- `ping` -- Verbindungstest
- `workspace.list` + `agent.list` -- Workspaces inkl. `pane_id`/`cwd` ermitteln
- `pane.send_text` + `pane.send_keys` -- To-Do in den Agent-Pane schreiben

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
- **Mit Enter abschicken** -- Enter nach dem Text senden

## Build

```bash
npm install
npm run build      # erzeugt main.js
```

Zum Testen Plugin-Ordner (mit `manifest.json`, `main.js`) nach
`<Vault>/.obsidian/plugins/herdr-obsidian/` kopieren oder symlinken und in
Obsidian unter "Community-Plugins" aktivieren.

## Status

Grundgeruest: ein funktionierender Sende-Command. Naechste Schritte:
Auto-Abhaken via `events.subscribe` (`pane.agent_status_changed`),
Settings-Feinschliff, Statusanzeige.

## Desktop-only

Nutzt Node-`net`/Unix-Sockets -- laeuft nur in Obsidian Desktop, nicht Mobile.
Bei entferntem Herdr muss der Socket lokal erreichbar sein (z.B. SSH-Forwarding).

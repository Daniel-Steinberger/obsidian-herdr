# Herdr Bridge (Obsidian-Plugin)

Verbindet Notizen-Checklisten in Obsidian mit Agents im
[Herdr](https://github.com/ogulcancelik/herdr)-Terminal-Multiplexer.

Workflow: Du führst deine To-Dos pro Projekt als Markdown-Checkliste in einer
Notiz. Per Command schickt das Plugin das nächste offene To-Do an den Agent im
zugehörigen Herdr-Workspace. Sobald der Agent fertig ist, wird die Checkbox
automatisch abgehakt. Ein kontinuierlicher Modus arbeitet die ganze Checkliste
nacheinander ab.

Quelle der Wahrheit ist die Obsidian-Notiz; Herdr ist nur der Ausführer.

## Installation

**Voraussetzungen**

- Obsidian **Desktop** (nutzt Node-`net`/Unix-Sockets, läuft nicht auf Mobile).
- Ein laufender **Herdr** (getestet gegen v0.7.1); der API-Socket muss lokal
  erreichbar sein (bei entferntem Herdr z.B. per SSH-Forwarding).
- Das **`herdr`-CLI** im PATH — wird fürs Auto-Abhaken benötigt
  (`herdr agent wait`). Ist der PATH in Obsidian nicht bekannt, lässt sich der
  volle Pfad in den Einstellungen hinterlegen.

**Aus dem Quelltext bauen und installieren**

```bash
npm install
npm run build      # erzeugt main.js (tsc-Check + esbuild)
```

Danach die drei Dateien `manifest.json`, `main.js` und `styles.css` in den
Plugin-Ordner deines Vaults kopieren — der Ordnername muss der Plugin-`id`
`herdr` entsprechen:

```
<Vault>/.obsidian/plugins/herdr/
├── manifest.json
├── main.js
└── styles.css
```

Für die Entwicklung ist ein **Symlink** praktischer (Änderungen sind nach
`npm run build` + Obsidian-Reload sofort aktiv):

```bash
ln -s /pfad/zu/obsidian-herdr <Vault>/.obsidian/plugins/herdr
```

Zum Schluss in Obsidian unter **Einstellungen → Community-Plugins** das Plugin
„Herdr Bridge" aktivieren.

## Verwendung

1. Lege in den Einstellungen einen **Herdr-Ordner** fest (Default `herdr`).
2. Erstelle darin eine Notiz mit einer Markdown-Checkliste.
3. Öffne in Herdr einen Workspace, der zur Notiz passt (siehe Mapping unten).
4. Löse eines der Commands aus — per Command-Palette oder über die Buttons in
   der Statusleiste.

### Statusleiste

Liegt die aktive Notiz im Herdr-Ordner, zeigt die Statusleiste unten die Zahl
der offenen To-Dos und zwei Buttons: **▶ nächster Schritt** (ein To-Do senden)
und **⏩ alle kontinuierlich** (Start/Stop des kontinuierlichen Modus).

### Notiz aus Herdr-Space anlegen (Ordner-Kontextmenü)

Ein Rechtsklick auf den Herdr-Ordner im Datei-Explorer zeigt das Untermenü
**„Herdr: Notiz für Space"** mit allen aktuell in Herdr geöffneten Spaces. Ein
Klick legt die dazu passende Notiz an (Dateiname = Space-Name; bei
dateinamens-unverträglichen Zeichen wird zusätzlich `herdr-workspace:` ins
Frontmatter geschrieben, damit das Mapping greift) oder öffnet sie, falls sie
schon existiert. So musst du den Namen nicht doppelt — in Herdr und in der
Notiz — vergeben.

### Status-Icons im Datei-Explorer

Ist die Option **Agent-Status-Icons im Datei-Explorer** aktiviert (Default),
zeigt das Plugin links neben jeder Notiz im Herdr-Ordner ein Icon mit dem
Herdr-Agent-Status — in derselben Optik wie Herdrs eigene Anzeige:

| Icon | Farbe | Bedeutung |
|------|-------|-----------|
| ✓ | grün | idle (fertig, bereits gesehen) |
| ● | teal | done (fertig, noch nicht gesehen) |
| ● | gelb (pulsiert) | working |
| ◉ | rot | blocked |
| ○ | grau | kein Agent / nicht zugeordnet |

Der Status wird regelmäßig aus Herdr abgefragt (Intervall einstellbar) und
sofort bei Datei- oder Layout-Änderungen aktualisiert.

## Commands

- **Nächstes offenes To-Do an den Agent senden**
- **Kontinuierlichen Modus für diese Notiz starten** — arbeitet alle offenen
  To-Dos nacheinander ab: nach jedem fertigen To-Do wird automatisch das
  nächste gesendet, bis keins mehr offen ist (oder ein Schritt in den Timeout
  läuft).
- **Kontinuierlichen Modus stoppen** — stoppt den Durchlauf der aktiven Notiz
  (bzw. alle laufenden, falls die aktive Notiz keinen hat).
- **Multi-Agent-Handhabung für diese Notiz festlegen** — öffnet bei einem Space
  mit mehreren Agent-Tabs den Auswahldialog (siehe „Mehrere Agents pro Space").
- **Verbindung zu Herdr testen (ping)**

## Geltungsbereich (Herdr-Ordner)

In den Einstellungen legst du einen vault-relativen **Herdr-Ordner** fest
(Default `herdr`). Nur Notizen darin werden beachtet. Leer = ganzer Vault.

## Notiz ↔ Workspace Mapping

Innerhalb des Herdr-Ordners steht der **Dateiname** der Notiz für den Workspace.
Reihenfolge:

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

## Mehrere Agents pro Space

Hat ein Space mehrere Tabs (je Tab ein Agent) und die Notiz ist noch keinem Tab
zugeordnet, fragt das Plugin beim Senden per Dialog nach — mit drei Wegen:

1. **An einen Tab senden** — Tab auswählen; die Notiz zielt künftig immer darauf
   (gespeichert als Frontmatter `herdr-tab: <Tab>`).
2. **Sektionen in der Notiz** — je Tab eine Überschrift `# <space>.<tab>`; To-Dos
   unter einer Überschrift gehen an den jeweiligen Tab. Vorhandene To-Dos wandern
   unter die erste Sektion. Der Datei-Explorer zeigt dann ein Icon je Tab.
3. **In Dateien aufteilen** — die Notiz wird zu `<space>.<tab1>.md` umbenannt
   (behält den Inhalt) und je weiterem Tab eine leere `<space>.<tab>.md` angelegt.

Tabs werden per **Label, sonst Nummer** angesprochen. Über den Command
**„Multi-Agent-Handhabung für diese Notiz festlegen"** lässt sich die Wahl
jederzeit erneut treffen.

## Wie es funktioniert

Obsidian Desktop läuft auf Electron, daher kann das Plugin direkt den
Unix-Socket der Herdr-API ansprechen (line-delimited JSON) — **kein separater
Daemon nötig**. Verwendete API-Methoden:

- `ping` — Verbindungstest
- `workspace.list` + `agent.list` — Workspaces inkl. `pane_id`/`cwd` ermitteln
- `pane.send_input` — To-Do (Text + Enter) atomar in den Agent-Pane schreiben.
  Der Text wird serverseitig mit Bracketed-Paste-Markern umschlossen, damit das
  Enter als echtes Abschicken ankommt statt als Zeilenumbruch.

**Auto-Abhaken:** Hierfür ruft das Plugin Herdrs eigenen, erprobten CLI auf
(`herdr agent wait <pane> --status ...`). Grund: der rohe `events.subscribe`-
Stream lieferte in der getesteten Herdr-Version v0.7.1 unzuverlässig
Status-Events, während `herdr agent wait` zuverlässig funktioniert. Logik:
nach dem Senden auf `working` warten (Agent hat aufgenommen), danach auf `idle`
(fertig) → Checkbox abhaken. Begann der Agent nie erkennbar zu arbeiten, wird
NICHT abgehakt.

**Submit-Absicherung:** Wird das mit dem Text gebündelte Enter vom TUI-Agent
verschluckt (Text steht dann unabgeschickt im Eingabefeld), erkennt das Plugin
das am ausbleibenden `working`-Status und schickt in kurzen Intervallen ein
separates Enter nach, bis der Agent zu arbeiten beginnt oder das
Arbeitsbeginn-Zeitfenster abläuft.

## Sprache

Die Oberfläche folgt Obsidians eingestellter Sprache (Deutsch/Englisch,
Fallback Englisch).

## Einstellungen

- **Herdr-Ordner** — vault-relativer Ordner, den das Plugin beachtet (Default `herdr`); leer = ganzer Vault
- **Socket-Pfad** — leer = `$HERDR_SOCKET_PATH` bzw. `~/.config/herdr/herdr.sock`
- **herdr-Programmpfad** — fürs Auto-Abhaken; leer = `herdr` aus dem PATH.
  Falls Obsidian den PATH nicht kennt, vollen Pfad eintragen (z.B. `~/.local/bin/herdr`).
- **Mit Enter abschicken** — Enter nach dem Text senden
- **Automatisch abhaken** — Checkbox abhaken, wenn der Agent fertig ist
- **Timeout Arbeitsbeginn / Fertigstellung** — Wartegrenzen fürs Auto-Abhaken
- **Agent-Status-Icons im Datei-Explorer** — Status-Icon links neben jeder Notiz im Herdr-Ordner (Default an)
- **Aktualisierungsintervall** — wie oft der Status für die Explorer-Icons abgefragt wird (Sekunden; wirkt nach Plugin-Reload)

## Entwicklung

`test/itest.ts` und `test/itest2.ts` sind Integrationstests gegen einen
laufenden Herdr-Server (mit esbuild bündeln, dann mit node ausführen):

```bash
npx esbuild test/itest.ts --bundle --platform=node --format=cjs \
  --external:obsidian --outfile=test/itest.cjs && node test/itest.cjs
```

## Desktop-only

Nutzt Node-`net`/Unix-Sockets — läuft nur in Obsidian Desktop, nicht Mobile.
Bei entferntem Herdr muss der Socket lokal erreichbar sein (z.B. SSH-Forwarding).

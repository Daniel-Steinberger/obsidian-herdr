# obsidian-herdr — Handoff / Projektkontext

Obsidian-Desktop-Plugin als Brücke zwischen Notizen-Checklisten und dem
[Herdr](https://github.com/ogulcancelik/herdr)-Terminal-Multiplexer.

## Zweck / Workflow

To-Dos pro Projekt als Markdown-Checkliste in einer Notiz führen. Per Command
das nächste offene To-Do an den Agent im passenden Herdr-Workspace „pasten".
Wird der Agent fertig, hakt das Plugin die Checkbox automatisch ab. Optional ein
kontinuierlicher Modus, der die ganze Checkliste nacheinander abarbeitet.

Quelle der Wahrheit ist die Obsidian-Datei; Herdr ist nur Ausführer. Bewusste
Entscheidung gegen einen Herdr-Fork (Logik gehört auf die Obsidian-Seite, Herdrs
Socket-API ist genau dafür da).

## Architektur

Obsidian Desktop (Electron) → Node-`net`/`child_process`. Kein separater Daemon.

- `src/main.ts` — Plugin-Lifecycle, Commands, Settings, kontinuierlicher Modus,
  Statusbar-Leiste (Buttons „nächster Schritt" / „alle kontinuierlich",
  nur sichtbar wenn aktive Notiz im Geltungsbereich; `styles.css` im Root wird
  von Obsidian über den Symlink automatisch geladen).
- `src/herdr-client.ts` — Unix-Socket-Client (line-delimited JSON, eine
  Verbindung pro Request). Methoden: `ping`, `workspace.list`+`agent.list`
  (gejoint zu `WorkspaceView` mit `pane_id`/`cwd`), `pane.send_input`
  (Text + Enter atomar, siehe Erkenntnisse).
- `src/todos.ts` — Checklisten parsen/abhaken (Regex auf `- [ ]` / `* [x]`).
- `src/mapping.ts` — Notiz → Workspace (Frontmatter `herdr-workspace:` oder
  Dateiname, gematcht gegen Label/cwd-Basename).
- `src/agent-wait.ts` — wartet auf Agent-Status via `child_process` →
  `herdr agent wait`.
- `src/tracker.ts` — Auto-Abhaken-Zustandslogik + `onComplete`-Callback für die
  Verkettung im kontinuierlichen Modus + Submit-Absicherung (Enter-Retry, siehe
  Erkenntnisse).
- `src/explorer-icons.ts` — `ExplorerDecorator`: blendet je Notiz im
  Datei-Explorer links vom Namen ein Status-Icon ein (Herdr-Agent-Status).
  **Undokumentierte Obsidian-Internals** (`getLeavesOfType("file-explorer")`,
  `view.fileItems`, `titleEl`/`titleInnerEl`) → lokale Interfaces + Cast +
  Guards; MutationObserver hält Icons beim Neu-Rendern (Auf-/Zuklappen/Scrollen)
  nach. `apply()` ist idempotent (schreibt nur bei Änderung → kein
  Observer-Loop).
- `src/i18n.ts` — Internationalisierung. Sprache aus
  `localStorage["language"]` (leer = Englisch), Dictionaries `de`/`en`,
  `t(key, params)` mit `{name}`-Platzhaltern; Fallback en → Schlüssel. Alle
  sichtbaren Strings (Commands, Notices, Statusbar, Einstellungen) laufen
  darüber. Neue Sprache: Code in `SUPPORTED` + Dictionary mit denselben
  Schlüsseln wie `en`.

## WICHTIGE Erkenntnisse (live gegen Herdr v0.7.1 / Protokoll 14 verifiziert)

- **`events.subscribe` auf `pane.agent_status_changed` ist in v0.7.1
  unzuverlässig** — Status-Events kamen über den rohen Socket nicht an (auch mit
  `agent_status`-Filter; getrieben per `pane.report_agent`). `events.wait` ist
  über den Socket `not_implemented`. **Deshalb nutzt das Auto-Abhaken Herdrs
  eigenen CLI** (`herdr agent wait <pane> --status idle|working --timeout MS`,
  rc0=erreicht). Beim Reimplementieren NICHT auf rohes subscribe zurückfallen,
  ohne es vorher erneut zu verifizieren.
- v0.7.1 kennt **kein** `done`, nur `idle`/`working`/`blocked`/`unknown`.
  „Fertig" = **idle nach working**. Auto-Abhaken-Heuristik: nach Senden auf
  `working` warten (Aufnahme), dann auf `idle`. Kein Arbeitsbeginn erkannt →
  NICHT abhaken.
- **Senden via `pane.send_input` (`{pane_id, text, keys}`), NICHT `send_text` +
  separatem `send_keys`.** `send_text` schreibt rohe Bytes ohne Paste-Marker;
  ein danach in einem zweiten Request gefeuertes `send_keys ["Enter"]` versickert
  beim TUI-Agent zeitweise als Zeilenumbruch im Eingabefeld statt als Submit
  (Race + fehlendes Bracketed-Paste-Wrapping). `send_input` schreibt Text + Keys
  in EINEM atomaren Request und umschliesst den Text serverseitig mit
  Bracketed-Paste-Markern (`\e[200~…\e[201~`, nur wenn Agent bracketed_paste
  aktiv hat); das Enter landet garantiert nach dem End-Marker → echtes Submit.
  Verifiziert gegen v0.7.1 (dispatchbar, `{"type":"ok"}`). Server-Code:
  `handle_pane_send_input` + `encode_api_text` in `src/app/api{,_helpers}.rs`.
- **Submit-Absicherung (Enter-Retry):** Auch mit `send_input` wird das
  gebündelte Enter beim TUI-Agent gelegentlich verschluckt (Text steht dann
  unabgeschickt im Feld). Gegenmittel im Tracker (Schritt 1): in kurzen
  Intervallen (Default 2 s) per `herdr agent wait --status working` prüfen, ob
  der Agent zu arbeiten beginnt; bleibt er idle, ein **separates** Enter
  nachschicken (`client.submit(pane)` = `send_input {keys:["Enter"]}`, ohne
  Text). Das wiederholt sich **ohne festes Limit, bis der Agent einmal
  `working` war** (= gilt als abgeschickt) oder das Arbeitsbeginn-Zeitfenster
  (`workingTimeoutMs`) abläuft. Ein zeitlich getrenntes Enter wird vom
  idle-Agent als Submit erkannt (verifiziert: Text im Feld → `submit()` → Befehl
  läuft). Greift nur, wenn getrackt wird (continuous oder Auto-Abhaken) und
  „Mit Enter abschicken" an ist.
- Socket: `~/.config/herdr/herdr.sock` (oder `$HERDR_SOCKET_PATH`).
- `pane.read` zum Zurücklesen braucht `source: "visible"` (nicht `recent`).
- Test-Trick ohne echten Agent: `workspace.create {focus:true}` (focus:false →
  kein gerendertes Grid, leer), dann `pane.report_agent {state, seq:n}` treibt
  Statuswechsel. Danach `workspace.close`.
- Quellcode-Referenz für die API liegt im Klon `/home/dst/src/herdr` (Tag
  `v0.7.1`; `git show v0.7.1:src/api/schema/*.rs`). Der `master`-Klon ist
  Protokoll 15 und weicht ab — gegen den **installierten** Server (v0.7.1)
  prüfen.

## Mapping & Geltungsbereich

- Einstellung **`herdrFolder`** (Default `herdr`) = reiner Geltungsbereich: nur
  Notizen in diesem vault-relativen Ordner werden beachtet. Leer = ganzer Vault.
- Innerhalb davon steht der **Dateiname** für den Workspace; Frontmatter
  `herdr-workspace:` überschreibt.
- **Ordner-Kontextmenü** (`file-menu`-Event, `main.ts`): Rechtsklick auf den
  Herdr-Ordner (bzw. jeden Ordner, wenn `herdrFolder` leer ist) zeigt ein
  Untermenü „Herdr: Notiz für Space" mit allen Spaces aus `workspace.list`.
  Klick legt die passende Notiz an (Dateiname = sanitiztes Space-Label; bei
  dateinamens-unverträglichen Zeichen zusätzlich `herdr-workspace:`-Frontmatter,
  damit das Mapping greift) oder öffnet sie. Da `file-menu` **synchron** ist,
  liest das Menü aus `spacesCache` (befüllt bei `onLayoutReady` + bei jedem
  Öffnen des Ordner-Menüs neu). `setSubmenu` ist nicht in den Obsidian-Typen
  (Cast), erst ab 1.4 vorhanden → Fallback: flache Einträge im Hauptmenü.

## Explorer-Status-Icons

- Setting **`explorerStatusIcons`** (Default an) + **`explorerPollSec`**
  (Default 3). Zeigt links jeder Notiz im Herdr-Ordner ein Icon für den
  Herdr-Agent-Status, Optik wie Herdrs TUI: idle `✓` grün `#A6E3A1`, done `●`
  teal `#94E2D5`, working `●` gelb `#F9E2AF` (CSS-Puls), blocked `◉` rot
  `#F38BA8`, kein Agent `○` grau `#6C7086` (Glyphen/Farben aus
  `herdr:src/ui/status.rs` bzw. `state.rs`, Catppuccin Mocha; CSS in
  `styles.css`).
- **Status ist autoritativ aus `workspace.list.agent_status`** (bereits pro
  Workspace aggregiert; liefert `done` **direkt** — kein Selbst-Ableiten). Nur
  „kein Agent" leitet das Plugin ab: kein Workspace-Mapping **oder**
  `agent_status` ∉ {idle,done,working,blocked} (v.a. `unknown`). **KEIN
  pane_id-Guard** — der kippte bei Join-Race legitime done/idle fälschlich auf
  „none" (verifiziert).
- **Kein Herdr-Event, sondern Polling** (`registerInterval`, `refreshSpaces()`
  füttert `spacesCache`, dann `explorer.apply()`), plus Re-Apply bei
  `vault.on(create/rename/delete)` und `workspace.on("layout-change")`.
  Begründung: `events.subscribe` unzuverlässig (siehe Erkenntnisse).

## Kontinuierlicher Modus

- Start/Stop-Command pro Notiz. `main.ts` hält `continuous: Map<filePath,
  paneId>`. Der Tracker ruft `onComplete(marked)`; bei `true` wird das nächste
  offene To-Do gesendet, sonst Stop (z. B. Timeout).

## Build & Test

```bash
npm install
npm run build          # tsc -noEmit + esbuild -> main.js
```

Integrationstests laufen gegen einen **laufenden** Herdr-Server (kein Mock):

```bash
npx esbuild test/itest.ts  --bundle --platform=node --format=cjs --external:obsidian --outfile=test/itest.cjs && node test/itest.cjs
npx esbuild test/itest2.ts --bundle --platform=node --format=cjs --external:obsidian --outfile=test/itest2.cjs && node test/itest2.cjs
```

`itest.ts` = einzelner Auto-Abhaken-Zyklus; `itest2.ts` = kontinuierliche
Verkettung über 2 To-Dos. Beide legen einen Wegwerf-Workspace an und räumen ihn
wieder auf.

## Installation im Vault

Der Vault-Plugin-Ordner ist ein **Symlink** auf dieses Repo (Ordnername =
manifest-`id` `herdr`):
`/home/dst/Sync/DVS-Obsidian/.obsidian/plugins/herdr → /home/dst/src/obsidian-herdr/`.
`npm run build` aktualisiert damit direkt das installierte Plugin; in Obsidian
nur noch neu laden (Plugin aus/an oder App-Reload). Vault-Wurzel:
`/home/dst/Sync/DVS-Obsidian/`, Projektnotizen unter `herdr/`.

## Stand

v1.2.0 (Commits: Grundgerüst `20d635d`, Auto-Abhaken `2730bce`, Folder+Continuous
`f18eef1`, Release `a616aa6`; Senden via `pane.send_input` `51d9144`;
Statusbar-Buttons `6acfadb`; Submit-Absicherung `f09520d`; Internationalisierung
de/en `d2e1a78`; Umbenennung id `herdr`/Repo `obsidian-herdr` `ca8b1e7`; Release
1.0.0 `db6fb36`; Kontext-Einsammeln unter To-Dos + Release 1.1.0 `5d07a18`;
Ordner-Kontextmenü `a34f2fa`; Explorer-Status-Icons + Release 1.2.0 <Commit folgt>).
Funktioniert live: Senden, Mapping, Auto-Abhaken, kontinuierlicher Modus,
Statusbar-Leiste, Submit-Absicherung, i18n, eingerückter Kontext unter To-Dos,
Ordner-Kontextmenü, Explorer-Status-Icons (live gegen Herdr verifiziert; DOM
funktioniert in Obsidian, Explorer-Item-Felder sind `selfEl`/`innerEl`).
Eigenes Git-Repo, Branch `main`, Remote `origin`
(github.com/Daniel-Steinberger/obsidian-herdr).

`src/todos.ts` sammelt unter einer Checkbox eingerückte Folgezeilen (Freitext
oder Bullet-Punkte ohne eigene Checkbox) als `context` ein, solange sie
staerker eingerueckt sind als die Checkbox-Zeile selbst; eine eigene
verschachtelte Checkbox beendet das Einsammeln und bleibt eigenstaendig
trackbar. `withContext(todo)` haengt `context` an `text` an und wird beim
Senden (`main.ts` `doSend`) statt des reinen `text` an `pane.send_input`
gegeben; Notices zeigen weiterhin nur `todo.text`.

Offener Punkt zum Testen: Die Beispielnotiz `herdr/obsidian-herdr.md` mappt per
Dateiname auf einen Workspace `obsidian-herdr` — der muss in Herdr existieren
(Workspace im Verzeichnis `/home/dst/src/obsidian-herdr` öffnen) oder per
Frontmatter `herdr-workspace: herdr` auf den bestehenden `herdr`-Workspace
zeigen.

## Mögliche nächste Schritte

- Mehrere Agents pro Workspace unterscheiden (aktuell wird der erste genommen).
- Command zum Abbrechen einer einzelnen laufenden Verfolgung.
- Optional: rohes `events.subscribe` erneut prüfen, falls Herdr aktualisiert
  wird (dann ggf. CLI-Abhängigkeit ablösen).

## Konventionen

Antworten/Commits/Doku auf Deutsch (Umlaute korrekt). **Sichtbare UI-Strings
gehören NICHT als Literal in den Code, sondern in `src/i18n.ts`** (de + en);
deutsche Strings dort mit korrekten Umlauten (ä/ö/ü/ß), nicht ASCII-Digraphen.
Commits ohne AI-Co-Author-Zeile für dieses Repo nötig? — bisher mit
`Co-Authored-By: Claude ...`.
Temporäre Dateien NICHT ins Repo (siehe `.gitignore`: `main.js`, `test/*.cjs`,
`node_modules/`, `data.json`).

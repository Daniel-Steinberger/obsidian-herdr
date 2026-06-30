# herdr-obsidian — Handoff / Projektkontext

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
  Verkettung im kontinuierlichen Modus.

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

Der Vault-Plugin-Ordner ist ein **Symlink** auf dieses Repo:
`/home/dst/Sync/DVS-Obsidian/.obsidian/plugins/herdr-obsidian → /home/dst/src/herdr-obsidian/`.
`npm run build` aktualisiert damit direkt das installierte Plugin; in Obsidian
nur noch neu laden (Plugin aus/an oder App-Reload). Vault-Wurzel:
`/home/dst/Sync/DVS-Obsidian/`, Projektnotizen unter `herdr/`.

## Stand

v0.4.0 (Commits: Grundgerüst `20d635d`, Auto-Abhaken `2730bce`, Folder+Continuous
`f18eef1`, Release `a616aa6`; Senden via `pane.send_input`; Statusbar-Buttons).
Funktioniert live: Senden, Mapping, Auto-Abhaken, kontinuierlicher Modus,
Statusbar-Leiste. Eigenes Git-Repo, Branch `main`, kein Remote.

Offener Punkt zum Testen: Die Beispielnotiz `herdr/herdr-obsidian.md` mappt per
Dateiname auf einen Workspace `herdr-obsidian` — der muss in Herdr existieren
(Workspace im Verzeichnis `/home/dst/src/herdr-obsidian` öffnen) oder per
Frontmatter `herdr-workspace: herdr` auf den bestehenden `herdr`-Workspace
zeigen.

## Mögliche nächste Schritte

- Mehrere Agents pro Workspace unterscheiden (aktuell wird der erste genommen).
- Command zum Abbrechen einer einzelnen laufenden Verfolgung.
- Optional: rohes `events.subscribe` erneut prüfen, falls Herdr aktualisiert
  wird (dann ggf. CLI-Abhängigkeit ablösen).

## Konventionen

Antworten/Commits/Doku auf Deutsch (Umlaute korrekt). Commits ohne AI-Co-Author-
Zeile für dieses Repo nötig? — bisher mit `Co-Authored-By: Claude ...`.
Temporäre Dateien NICHT ins Repo (siehe `.gitignore`: `main.js`, `test/*.cjs`,
`node_modules/`, `data.json`).

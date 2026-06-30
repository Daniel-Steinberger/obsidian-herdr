// Integrationstest fuer die kontinuierliche Verkettung (ohne Obsidian).
// Simuliert: solange offene To-Dos -> working/idle-Zyklus -> abhaken -> naechstes.
import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { waitForStatus } from "../src/agent-wait";
import { markDone, nextOpen, parseTodos } from "../src/todos";

const SOCK = path.join(os.homedir(), ".config", "herdr", "herdr.sock");
function call(method: string, params: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const s = net.connect(SOCK);
    let buf = "";
    s.setEncoding("utf8");
    s.on("connect", () => s.write(JSON.stringify({ id: "t", method, params }) + "\n"));
    s.on("data", (c: string) => { buf += c; const nl = buf.indexOf("\n"); if (nl >= 0) { s.destroy(); resolve(JSON.parse(buf.slice(0, nl)).result); } });
    s.on("error", reject);
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await call("workspace.create", { cwd: os.homedir(), focus: true });
  const pane = res.root_pane.pane_id as string;
  const ws = res.workspace.workspace_id as string;
  const md = path.join(os.tmpdir(), `herdr-itest2-${process.pid}.md`);
  fs.writeFileSync(md, "## To-Dos\n- [ ] aufgabe eins\n- [ ] aufgabe zwei\n");
  console.log("pane", pane);

  let seq = 0;
  let steps = 0;
  try {
    // kontinuierliche Schleife (entspricht onContinuousStep)
    for (;;) {
      const todo = nextOpen(fs.readFileSync(md, "utf8"));
      if (!todo) break;
      steps++;
      console.log(`Schritt ${steps}: sende "${todo.text}"`);

      // "Agent" beginnt zu arbeiten
      await call("pane.report_agent", { pane_id: pane, source: "itest", agent: "claude", state: "working", seq: ++seq });
      const r1 = await waitForStatus("herdr", pane, "working", 5000).promise;
      if (r1 !== "matched") { console.log("FAIL working"); process.exitCode = 1; return; }

      // nach 1s fertig
      const mySeq = ++seq;
      void (async () => { await sleep(1000); await call("pane.report_agent", { pane_id: pane, source: "itest", agent: "claude", state: "idle", seq: mySeq }); })();
      const r2 = await waitForStatus("herdr", pane, "idle", 8000).promise;
      if (r2 !== "matched") { console.log("FAIL idle"); process.exitCode = 1; return; }

      fs.writeFileSync(md, markDone(fs.readFileSync(md, "utf8"), todo.lineNo));
      console.log(`  abgehakt: "${todo.text}"`);
    }

    const todos = parseTodos(fs.readFileSync(md, "utf8"));
    const allDone = todos.length === 2 && todos.every((t) => t.done);
    console.log("Schritte:", steps, "alle abgehakt?", allDone, "RESULT:", allDone && steps === 2 ? "PASS" : "FAIL");
    process.exitCode = allDone && steps === 2 ? 0 : 1;
  } finally {
    fs.rmSync(md, { force: true });
    await call("workspace.close", { workspace_id: ws });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

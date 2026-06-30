// Integrationstest OHNE Obsidian: testet agent-wait.ts + todos.ts gegen den
// laufenden Herdr-Server. Simuliert den Tracker-Ablauf (working -> idle -> abhaken).
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
    s.on("data", (c: string) => {
      buf += c;
      const nl = buf.indexOf("\n");
      if (nl >= 0) { s.destroy(); resolve(JSON.parse(buf.slice(0, nl)).result); }
    });
    s.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await call("workspace.create", { cwd: os.homedir(), focus: true });
  const pane = res.root_pane.pane_id as string;
  const ws = res.workspace.workspace_id as string;
  console.log("pane", pane, "ws", ws);

  // Temp-Notiz mit einem offenen To-Do
  const md = path.join(os.tmpdir(), `herdr-itest-${process.pid}.md`);
  fs.writeFileSync(md, "## To-Dos\n- [ ] integrationstest aufgabe\n");
  const todo = nextOpen(fs.readFileSync(md, "utf8"))!;
  console.log("naechstes To-Do:", todo.text, "Zeile", todo.lineNo);

  try {
    // Agent meldet "working"
    await call("pane.report_agent", { pane_id: pane, source: "itest", agent: "claude", state: "working", seq: 1 });

    // Schritt 1: auf working warten (sollte sofort matchen)
    const r1 = await waitForStatus("herdr", pane, "working", 5000).promise;
    console.log("wait working ->", r1);

    // Nach 1.5s meldet Agent "idle"
    void (async () => { await sleep(1500); await call("pane.report_agent", { pane_id: pane, source: "itest", agent: "claude", state: "idle", seq: 2 }); console.log(">> reported idle"); })();

    // Schritt 2: auf idle warten
    const r2 = await waitForStatus("herdr", pane, "idle", 8000).promise;
    console.log("wait idle ->", r2);

    if (r2 === "matched") {
      const content = fs.readFileSync(md, "utf8");
      fs.writeFileSync(md, markDone(content, todo.lineNo));
      const after = parseTodos(fs.readFileSync(md, "utf8"))[0];
      console.log("Checkbox done?", after.done, "RESULT:", after.done ? "PASS" : "FAIL");
      process.exitCode = after.done ? 0 : 1;
    } else {
      console.log("RESULT: FAIL (idle nicht erreicht)");
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(md, { force: true });
    await call("workspace.close", { workspace_id: ws });
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

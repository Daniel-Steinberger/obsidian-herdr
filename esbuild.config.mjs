import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  // Obsidian-API, Electron, CodeMirror (von Obsidian bereitgestellt) und alle
  // Node-Builtins werden zur Laufzeit bereitgestellt -- nicht mitbundeln
  // (sonst greifen Editor-Extensions gegen eine zweite CM6-Instanz nicht).
  external: [
    "obsidian",
    "electron",
    "@codemirror/view",
    "@codemirror/state",
    "@codemirror/language",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  platform: "node"
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}

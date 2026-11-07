// Local demo server. Serves the page, the emulator as browser JavaScript, ROMs and
// generated rewrites. Run: node src/demo/server.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 5173);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ch8": "application/octet-stream",
  ".png": "image/png",
};

const ROOTS: [string, string][] = [
  ["/targets/", "targets"],
  ["/generated/", "generated"],
  ["/remakes/", "src/demo/remakes"],
  ["/", "src/demo/public"],
];

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);

  // The newest agent investigation for a game: findings and verifier results
  // only, read straight from the run log.
  if (path === "/api/investigation") {
    const game = new URL(request.url ?? "/", "http://localhost").searchParams.get("game") ?? "";
    const dir = join("runs", game.replace(/[^A-Za-z0-9]/g, ""));
    const runs = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.includes(".mod.")).sort()
      : [];
    const events = runs.length
      ? readFileSync(join(dir, runs[runs.length - 1]), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
          .filter((e) => e.type === "finding" || e.type === "verify" || e.type === "finish")
          .map((e) =>
            e.type === "verify"
              ? {
                  type: "verify",
                  at: e.at,
                  matched: e.result.stepsMatched,
                  planned: e.result.stepsPlanned,
                  openingAgreement: e.result.firstScreenAgreement ?? null,
                  mismatch: e.result.mismatch
                    ? {
                        step: e.result.mismatch.step,
                        pixels: e.result.mismatch.pixelsDiffering,
                        agreement: e.result.mismatch.agreement ?? null,
                      }
                    : null,
                }
              : e,
          )
      : [];
    response.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
    response.end(JSON.stringify({ run: runs[runs.length - 1] ?? null, events }));
    return;
  }

  if (path === "/lib/chip8.js") {
    const source = readFileSync("src/emulator/chip8.ts", "utf8");
    response.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
    response.end(stripTypeScriptTypes(source));
    return;
  }

  const wanted = path === "/" ? "/index.html" : path;
  for (const [prefix, root] of ROOTS) {
    if (!wanted.startsWith(prefix)) continue;
    const relative = normalize(wanted.slice(prefix.length));
    if (relative.startsWith("..")) break;
    const file = join(root, relative);
    if (existsSync(file)) {
      response.writeHead(200, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(readFileSync(file));
      return;
    }
  }
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found");
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Demo running at http://127.0.0.1:${PORT}`);
});

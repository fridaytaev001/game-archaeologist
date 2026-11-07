// Mod builder: turns a plain-English request into a change to the checked
// rewrite, then reports which game values the change affected.
// Run: node src/agent/mod.ts <game> "<request>"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkRewrite, compareMod, describeMod, GAMES } from "../lab/lab.ts";
import { chat, loadApiKey, type Message, type Tool } from "./meta.ts";

const game = process.argv[2] ?? "br8kout";
const request = process.argv.slice(3).join(" ");
if (!request) throw new Error('Usage: node src/agent/mod.ts <game> "<request>"');

const baseline = readFileSync(`generated/${game}.js`, "utf8");
const rom = new Uint8Array(readFileSync(GAMES[game].file));
const SEEDS = [101, 202, 303, 404, 505, 606];
const STEPS = 800;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(`runs/${game}`, { recursive: true });
const logFile = `runs/${game}/${stamp}.mod.jsonl`;
const log = (event: Record<string, unknown>): void =>
  appendFileSync(logFile, `${JSON.stringify({ at: Date.now(), ...event })}\n`);

const tools: Tool[] = [
  {
    type: "function",
    function: {
      name: "write_mod",
      description:
        "Save the complete modded game and compare it with the unmodded one on identical inputs.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string" },
          intended_changes: {
            type: "array",
            items: { type: "string" },
            description:
              "Names of state() values the request changes directly. Values that change only as a consequence are reported separately as knock-on changes.",
          },
        },
        required: ["code", "intended_changes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "End when the comparison shows only the intended changes.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
  },
];

const messages: Message[] = [
  {
    role: "system",
    content: `You modify a game's rules on request. The game below is a rewrite that has been checked against the original. Change only what the request asks for and keep everything else identical, including the order of rand() calls. Keep the same interface (SYNC_PC, START_KEYS if present, createGame, width, height, pixels, state, step). ROM_BYTES is available for data, as in the original rewrite. If the request adds a new value, expose it in state(). Plain JavaScript only, no imports, and no emulator or program counter.

Checked rewrite:
${baseline}`,
  },
  { role: "user", content: `Request: ${request}` },
];

const key = loadApiKey();
let done = false;
let accepted = false;
for (let turn = 1; turn <= 6 && !done; turn++) {
  const { message } = await chat(key, messages, tools);
  messages.push(message);
  log({ type: "assistant", turn, content: message.content, calls: message.tool_calls ?? [] });
  if (!message.tool_calls?.length) {
    messages.push({ role: "user", content: "Use write_mod, then finish." });
    continue;
  }
  for (const call of message.tool_calls) {
    const args = JSON.parse(call.function.arguments || "{}");
    let result: string;
    if (call.function.name === "write_mod") {
      const problems = checkRewrite(String(args.code));
      if (problems.length) {
        result = `Rejected: the mod ${problems.join("; ")}.`;
      } else {
        try {
          const report = compareMod(baseline, String(args.code), SEEDS, STEPS, GAMES[game].testKeys, rom);
          const intended = new Set<string>(args.intended_changes ?? []);
          const directChanges = report.changedValues.filter((c) => c.direct);
          const surprises = directChanges.filter((c) => !intended.has(c.name));
          const missing = [...intended].filter((n) => !directChanges.some((c) => c.name === n));
          result = `${describeMod(report)}\nIntended direct changes: ${[...intended].join(", ")}.\n${
            surprises.length
              ? `UNINTENDED DIRECT CHANGES: ${surprises.map((s) => s.name).join(", ")}. Fix them; do not add them to intended_changes unless the request asks for them.`
              : "Every direct change was intended. Knock-on changes follow from them."
          }${missing.length ? `\nIntended but not directly changed: ${missing.join(", ")}.` : ""}`;
          writeFileSync(`generated/${game}.mod.js`, String(args.code));
          accepted = true;
          log({ type: "mod", code: args.code, intended: [...intended], report });
        } catch (error) {
          result = `The mod crashed: ${(error as Error).message}`;
        }
      }
    } else if (call.function.name === "finish") {
      done = true;
      result = "Finished.";
      log({ type: "finish", summary: args.summary });
      console.log(`Summary: ${args.summary}`);
    } else {
      result = `Unknown tool ${call.function.name}.`;
    }
    console.log(`[${turn}] ${call.function.name}\n${result}\n`);
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
  }
}
console.log(accepted ? `Saved generated/${game}.mod.js` : "No mod was saved.");
console.log(`Log: ${logFile}`);

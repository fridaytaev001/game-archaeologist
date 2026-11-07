// The scientist agent. It can only touch the game through the tools below.
// Run: node src/agent/run.ts <game> [maxTurns] [costLimitUsd] [reasoning: low|medium|high]
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { checkRewrite, describeResult, Lab, verify } from "../lab/lab.ts";
import { chat, loadApiKey, type Message, type Tool } from "./meta.ts";

const game = process.argv[2] ?? "br8kout";
const maxTurns = Number(process.argv[3] ?? 40);
const COST_LIMIT_USD = Number(process.argv[4] ?? 4);
const DEV_SEEDS = [11, 22, 33, 44, 55, 66];
const DEV_STEPS = 600;
const KEEP_RECENT_TOOL_RESULTS = 14;
const REASONING = (process.argv[5] ?? "high") as "low" | "medium" | "high";
const FIRST_REWRITE_BY_TURN = 10;
const REWRITE_EVERY_TURNS = 5;

const lab = new Lab(game);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logFile = `runs/${game}/${stamp}.jsonl`;
const rewriteFile = `generated/${game}.js`;
const draftFile = `generated/${game}.draft.js`;
mkdirSync(`runs/${game}`, { recursive: true });
mkdirSync("generated", { recursive: true });

const log = (event: Record<string, unknown>): void => {
  appendFileSync(logFile, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
};

type Finding = { id: number; label: string; claim: string; evidence: string; replaces?: number };
const findings: Finding[] = [];

const SYSTEM = `You are a software archaeologist. You have a compiled game for the CHIP-8 family (possibly using SUPER-CHIP or XO-CHIP extensions) and no source code. Work out how it behaves, then write a readable rewrite that behaves the same way.

Method:
- Evidence comes only from your tools. Do not rely on any memory of this game.
- Work in two phases. Phase 1: choose SYNC_PC (the top of the main gameplay loop) and START_KEYS, then make the opening screen at SYNC_PC match exactly. trace_to_sync lists every draw since the last full clear, with sprite addresses in the ROM, so you can reproduce the screen by drawing the same sprites from ROM_BYTES at the same places. Phase 2: use trace_steps to see what each step draws, read the code that decides those positions, and make step(keys) do the same.
- Iterate in small increments. The verifier reports the share of matching pixels, so a rewrite that gets the screen 80% right is real progress. Run write_rewrite often.
- For a large ROM, start with code_map and profile to find the main loop and the busiest routines, then read those first.
- Before an experiment, record the hypothesis as Inferred. Design the experiment so it could prove you wrong.
- Keep the findings ledger current with record_finding: Recovered (read directly from the ROM), Observed (shown by an experiment), Inferred (not yet established), Unresolved (missing or conflicting evidence). Upgrade a finding with "replaces" once evidence supports it.
- Older tool results are trimmed from your context, so record anything you will need later as a finding. list_findings shows the ledger.
- Write a first rewrite early, even if partial, and let the verifier tell you where it first differs. When it reports a mismatch, explain the cause before changing the rewrite, and record what you learned.

Disassembly notes: lines marked * have run. Code can start on odd addresses. "data" lines are bytes not reached by following jumps and calls. Keys are hex keys 0-f. In hires mode the screen is 128x64; XO-CHIP has two bit planes, so a pixel value is 0-3 (bit 0 = plane 1, bit 1 = plane 2). Sprites with height 0 are 16x16. Drawing XORs pixels and sets VF when a lit pixel is erased. Sprites wrap at screen edges.

The rewrite is plain JavaScript with no imports:

const SYNC_PC = 0x000; // address at the top of the game's main loop, where one step begins
const START_KEYS = []; // optional: hex keys to press (and release, repeatedly) to get from power-on to the first SYNC_PC
function createGame(rand) { // rand() returns the next byte (0-255) of the same stream the original's random instruction reads, from power-on; createGame must consume any random draws the original makes before its first SYNC_PC
  // Set up the game exactly as it stands the first time the original reaches SYNC_PC.
  return {
    width: 64, height: 32, // the screen size at SYNC_PC: 128x64 in hires mode
    pixels() { /* array of width*height values, row by row, each 0-3 */ },
    state() { /* object of named game values, such as positions, score and lives */ },
    step(keys) { /* advance one main-loop iteration; keys is a bitmask, bit N = hex key N held */ }
  };
}

ROM_BYTES is available to the rewrite: a read-only copy of the ROM, where ROM_BYTES[address - 0x200] is the byte at that address. Use it to copy sprite, level and text data instead of retyping it.

Rules for the rewrite: express the rules as game logic with descriptive names and short comments. Do not write an emulator, instruction interpreter or program counter, and do not execute ROM bytes. Consume rand() in the same order as the original.

The verifier holds the same keys in both versions for each step and compares every pixel after each step. Its final test will use seeds and inputs you have not seen. The best-scoring rewrite is kept. When the rewrite passes, or when you cannot improve it further, call finish with an honest summary of what is and is not covered.`;

const addr = { type: "string", description: "Hex address, like 0x2b5" };
const inputs = {
  type: "array",
  description: "Segments played in order.",
  items: {
    type: "object",
    properties: {
      frames: { type: "integer", description: "60 Hz frames, up to 3000 per segment" },
      keys: { type: "array", items: { type: "integer" }, description: "Hex keys held" },
    },
    required: ["frames"],
  },
};

const tools: Tool[] = [
  {
    type: "function",
    function: {
      name: "trace_to_sync",
      description:
        "Run the original from power-on, pressing start_keys, until pc first reaches sync_pc. Lists every draw, clear, scroll and random draw since the last full clear, with sprite source addresses, plus the registers at sync.",
      parameters: {
        type: "object",
        properties: {
          seed: { type: "integer" },
          sync_pc: addr,
          start_keys: { type: "array", items: { type: "integer" } },
        },
        required: ["seed", "sync_pc"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trace_steps",
      description:
        "Reach sync_pc as in trace_to_sync, then run up to 30 steps (each from sync_pc back to sync_pc) holding the given keys, listing what each step draws and the registers after it.",
      parameters: {
        type: "object",
        properties: {
          seed: { type: "integer" },
          sync_pc: addr,
          start_keys: { type: "array", items: { type: "integer" } },
          steps: {
            type: "array",
            items: { type: "array", items: { type: "integer" } },
            description: "Keys held during each step, e.g. [[],[9],[9],[]]",
          },
        },
        required: ["seed", "sync_pc", "steps"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_bytes",
      description: "Find a hex byte sequence in the ROM, to locate sprite or level data.",
      parameters: {
        type: "object",
        properties: { hex: { type: "string" } },
        required: ["hex"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_map",
      description: "List the ROM's code ranges and subroutine entry points.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "profile",
      description: "Replay inputs from a fresh start and report the most-called subroutines and most-run instructions.",
      parameters: {
        type: "object",
        properties: { seed: { type: "integer" }, inputs },
        required: ["seed", "inputs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "disassemble",
      description: "Disassemble part of the ROM, up to 0x300 bytes at a time.",
      parameters: {
        type: "object",
        properties: { start: addr, end: addr },
        required: ["start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_experiment",
      description:
        "Start the original fresh and replay inputs. Returns registers, a log of watched memory changes, and optionally the final screen. Optionally log registers each time pc reaches break_at.",
      parameters: {
        type: "object",
        properties: {
          seed: { type: "integer" },
          inputs,
          watch: { type: "array", items: { type: "string" }, description: "Hex addresses" },
          break_at: addr,
          show_screen: { type: "boolean", description: "Default true" },
        },
        required: ["seed", "inputs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_memory",
      description: "Read up to 256 bytes of memory from the end of the last experiment or profile.",
      parameters: {
        type: "object",
        properties: { address: addr, length: { type: "integer" } },
        required: ["address", "length"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_finding",
      description: "Add a finding to the evidence ledger, optionally replacing an earlier one.",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string", enum: ["Recovered", "Observed", "Inferred", "Unresolved"] },
          claim: { type: "string" },
          evidence: { type: "string" },
          replaces: { type: "integer", description: "Id of a finding this one updates" },
        },
        required: ["label", "claim", "evidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_findings",
      description: "Show the current findings ledger.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "write_rewrite",
      description: "Save the complete rewrite and run the verifier on development seeds.",
      parameters: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "End the investigation with an honest summary of coverage.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
  },
];

const parseAddr = (text: string): number => parseInt(String(text).replace(/^0x/i, ""), 16);
const toSegments = (raw: unknown): { frames: number; keys?: number[] }[] =>
  ((raw as { frames: number; keys?: number[] }[]) ?? []).map((s) => ({
    frames: Math.min(Number(s.frames) || 0, 3000),
    keys: s.keys,
  }));

let finished = false;
let best = -1;
let lastRewriteTurn = 0;

function currentFindings(): Finding[] {
  const replaced = new Set(findings.map((f) => f.replaces).filter((n) => n !== undefined));
  return findings.filter((f) => !replaced.has(f.id));
}

function runTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "trace_to_sync":
      return lab.traceToSync(Number(args.seed) || 1, parseAddr(args.sync_pc), args.start_keys ?? []);
    case "trace_steps":
      return lab.traceSteps(
        Number(args.seed) || 1,
        parseAddr(args.sync_pc),
        args.start_keys ?? [],
        (args.steps ?? []).map((k: unknown) => (Array.isArray(k) ? k.map(Number) : [])),
      );
    case "find_bytes":
      return lab.findBytes(String(args.hex ?? ""));
    case "code_map":
      return lab.codeMap();
    case "profile":
      return lab.profile(Number(args.seed) || 1, toSegments(args.inputs));
    case "disassemble": {
      const start = parseAddr(args.start);
      const end = Math.min(parseAddr(args.end), start + 0x300);
      return lab.disassemble(start, end);
    }
    case "run_experiment":
      return lab.experiment(
        Number(args.seed) || 1,
        toSegments(args.inputs),
        (args.watch ?? []).map(parseAddr),
        args.break_at ? parseAddr(args.break_at) : undefined,
        args.show_screen !== false,
      );
    case "read_memory":
      return lab.readMemory(parseAddr(args.address), Number(args.length) || 16);
    case "record_finding": {
      const finding: Finding = {
        id: findings.length + 1,
        label: args.label,
        claim: args.claim,
        evidence: args.evidence,
        replaces: args.replaces === undefined ? undefined : Number(args.replaces),
      };
      findings.push(finding);
      log({ type: "finding", ...finding });
      return `Recorded finding ${finding.id}.`;
    }
    case "list_findings":
      return (
        currentFindings()
          .map((f) => `${f.id}. [${f.label}] ${f.claim} (evidence: ${f.evidence})`)
          .join("\n") || "No findings yet."
      );
    case "write_rewrite": {
      const code = String(args.code);
      const problems = checkRewrite(code);
      if (problems.length) {
        log({ type: "rewrite_rejected", problems });
        return `Rejected, not saved. The rewrite ${problems.join("; ")}.`;
      }
      lastRewriteTurn = currentTurn;
      writeFileSync(draftFile, code);
      const result = verify(lab.rom, lab.config, code, DEV_SEEDS, DEV_STEPS);
      const score = result.stepsMatched + (result.mismatch ? result.mismatch.agreement : 1);
      let note: string;
      if (score >= best) {
        best = score;
        writeFileSync(rewriteFile, code);
        note = "Saved as the best rewrite so far.";
      } else {
        note = `Not saved: the best rewrite so far scored ${best.toFixed(3)} (steps matched plus agreement of its first mismatched screen).`;
      }
      log({ type: "verify", code, result });
      return `${describeResult(result)}\n${note}`;
    }
    case "finish":
      finished = true;
      log({ type: "finish", summary: args.summary });
      return "Finished.";
    default:
      return `Unknown tool ${name}.`;
  }
}

// Replaces all but the most recent tool results with a stub, so long
// investigations fit in context. Findings carry what matters forward.
function compactHistory(messages: Message[]): void {
  const toolIndexes = messages.flatMap((m, i) => (m.role === "tool" ? [i] : []));
  for (const i of toolIndexes.slice(0, -KEEP_RECENT_TOOL_RESULTS)) {
    const m = messages[i];
    if (m.content && !m.content.startsWith("[trimmed")) {
      m.content = `[trimmed older result: ${m.content.slice(0, 160).replace(/\n/g, " ")} ...]`;
    }
  }
}

const key = loadApiKey();
const messages: Message[] = [
  { role: "system", content: SYSTEM },
  {
    role: "user",
    content: `The target ROM is ${lab.rom.length} bytes, loaded at 0x200. Begin your investigation.`,
  },
];

let inputTokens = 0;
let outputTokens = 0;
const cost = (): number => (inputTokens * 1.25 + outputTokens * 4.25) / 1e6;

async function chatWithRetry(onlyRewrite = false): Promise<Awaited<ReturnType<typeof chat>>> {
  const offered = onlyRewrite ? tools.filter((t) => t.function.name === "write_rewrite") : tools;
  for (let attempt = 1; ; attempt++) {
    try {
      return await chat(key, messages, offered, REASONING);
    } catch (error) {
      if (attempt >= 4) throw error;
      console.log(`retrying after error: ${(error as Error).message.slice(0, 200)}`);
      await new Promise((done) => setTimeout(done, attempt * 3000));
    }
  }
}

let currentTurn = 0;
for (let turn = 1; turn <= maxTurns && !finished; turn++) {
  currentTurn = turn;
  // Keep the investigation tied to the verifier: an early first rewrite, then
  // regular checks, so mismatches steer what the agent reads next.
  if (lastRewriteTurn === 0 && turn === FIRST_REWRITE_BY_TURN) {
    messages.push({
      role: "user",
      content:
        "Write your first rewrite now with write_rewrite, even if it only reproduces part of the screen at SYNC_PC. The verifier's pixel agreement and first mismatch will tell you what to fix next. Only write_rewrite is available until you do.",
    });
  } else if (lastRewriteTurn > 0 && turn - lastRewriteTurn === REWRITE_EVERY_TURNS) {
    messages.push({
      role: "user",
      content:
        "Several turns have passed since your last rewrite. Apply what you have learned and run write_rewrite now. Only write_rewrite is available until you do.",
    });
  }
  if (cost() > COST_LIMIT_USD) {
    console.log(`Stopping at the $${COST_LIMIT_USD} limit.`);
    log({ type: "stopped", reason: "cost limit" });
    break;
  }
  if (turn === maxTurns - 2) {
    messages.push({
      role: "user",
      content: "Two turns remain. Save your best rewrite now if it is not saved, then call finish.",
    });
  }
  compactHistory(messages);
  const overdue =
    (lastRewriteTurn === 0 && turn > FIRST_REWRITE_BY_TURN) ||
    (lastRewriteTurn > 0 && turn - lastRewriteTurn > REWRITE_EVERY_TURNS);
  const { message, usage } = await chatWithRetry(overdue);
  inputTokens += Number(usage?.prompt_tokens ?? 0);
  outputTokens += Number(usage?.completion_tokens ?? 0);
  messages.push(message);
  log({ type: "assistant", turn, content: message.content, calls: message.tool_calls ?? [] });
  if (message.content) console.log(`\n[${turn}] ${message.content.slice(0, 600)}`);

  if (!message.tool_calls?.length) {
    messages.push({
      role: "user",
      content: "Continue using the tools, or call finish if you are done.",
    });
    continue;
  }

  for (const call of message.tool_calls) {
    let result: string;
    try {
      const args = JSON.parse(call.function.arguments || "{}");
      console.log(`[${turn}] ${call.function.name} ${call.function.arguments.slice(0, 160)}`);
      result = runTool(call.function.name, args);
    } catch (error) {
      result = `Tool error: ${(error as Error).message}`;
    }
    log({ type: "tool", turn, name: call.function.name, result });
    const short = result.split("\n").slice(0, 5).join(" | ").slice(0, 400);
    console.log(`   -> ${short}`);
    messages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 14000) });
  }
}

writeFileSync(`runs/${game}/${stamp}.findings.json`, JSON.stringify(currentFindings(), null, 2));
console.log(`\nDone. Turns log: ${logFile}`);
console.log(`Tokens in/out: ${inputTokens}/${outputTokens}, about $${cost().toFixed(3)} before caching`);
console.log(`Findings: ${currentFindings().length}. Best score on dev seeds (steps matched + first-mismatch agreement): ${best.toFixed(3)}`);

// The lab: everything the agent may do to the original, plus the verifier.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Chip8, makeRand } from "../emulator/chip8.ts";
import { disassemble, findCode } from "../emulator/disasm.ts";

// `testKeys` only shapes the verifier's random inputs toward keys that matter.
// It is never shown to the agent.
export type GameConfig = { file: string; ticksPerFrame: number; testKeys: number[] };

export const GAMES: Record<string, GameConfig> = {
  br8kout: { file: "targets/br8kout.ch8", ticksPerFrame: 7, testKeys: [7, 9] },
  slipperyslope: { file: "targets/slipperyslope.ch8", ticksPerFrame: 30, testKeys: [9] },
  chickenScratch: {
    file: "targets/chickenScratch.ch8",
    ticksPerFrame: 500,
    testKeys: [5, 7, 8, 9],
  },
};

// Plays the rewrite's declared start keys (pressed and released in turn) until
// the original first reaches the sync address.
export function reachSync(c: Chip8, syncPc: number, startKeys: number): boolean {
  for (let f = 0; f < 3000; f++) {
    const keys = startKeys && Math.floor(f / 10) % 2 === 0 ? startKeys : 0;
    if (c.runUntil(syncPc, keys, 1)) return true;
    if (c.halted) return false;
  }
  return false;
}

export type InputSegment = { frames: number; keys?: number[] };

export const keyMask = (keys: number[] = []): number =>
  keys.reduce((mask, k) => mask | (1 << (k & 0xf)), 0);

const hex = (n: number, width = 2): string => n.toString(16).padStart(width, "0");

// A rewrite must be readable game logic. These checks reject the two ways to fake
// one: rebuilding an emulator, or reaching outside the sandbox.
const BANNED: [RegExp, string][] = [
  [/\bopcode\b/i, "mentions opcodes"],
  [/\b(pc|programCounter|instructionPointer)\b/, "keeps a program counter"],
  [/\b(fetch|decode)\w*\s*\(/i, "has a fetch or decode step"],
  [/new\s+Uint8Array\s*\(\s*(4096|0x1000|65536|0x10000)\s*\)/, "allocates emulator memory"],
  [/\b(import|require|process|globalThis|eval|Function)\b/, "reaches outside the sandbox"],
  [/\bconstructor\b/, "reaches outside the sandbox"],
];

export function checkRewrite(code: string): string[] {
  const problems = BANNED.filter(([pattern]) => pattern.test(code)).map(([, why]) => why);
  if (!/\bfunction\s+createGame\b/.test(code)) problems.push("does not define createGame");
  if (!/\bSYNC_PC\b/.test(code)) problems.push("does not define SYNC_PC");
  return problems;
}

type Game = {
  width: number;
  height: number;
  pixels(): ArrayLike<number>;
  state(): Record<string, unknown>;
  step(keys: number): void;
};

// Runs model-written code in a separate context with a time limit on every call.
class Sandbox {
  private context: vm.Context;
  readonly syncPc: number;
  readonly startKeys: number;

  constructor(code: string, rom?: Uint8Array) {
    this.context = vm.createContext({});
    if (rom) {
      // A copy owned by the sandbox, so the rewrite can read sprite and level data.
      const copy = vm.runInContext(`new Uint8Array(${rom.length})`, this.context);
      copy.set(rom);
      this.context.ROM_BYTES = copy;
    }
    vm.runInContext(
      `${code}\n;globalThis.__sync = SYNC_PC; globalThis.__start = typeof START_KEYS === "undefined" ? [] : Array.from(START_KEYS);`,
      this.context,
      { timeout: 1000 },
    );
    this.syncPc = this.context.__sync;
    this.startKeys = keyMask(this.context.__start);
  }

  // `skip` = random bytes the original already drew before its first sync.
  start(seed: number, skip = 0): void {
    const rand = makeRand(seed);
    for (let k = 0; k < skip; k++) rand();
    this.context.__rand = rand;
    this.run("globalThis.__game = createGame(__rand);");
  }

  step(keys: number): void {
    this.context.__keys = keys;
    this.run("__game.step(__keys);");
  }

  get game(): Game {
    return this.context.__game;
  }

  pixels(): number[] {
    return Array.from(this.run("Array.from(__game.pixels())") as number[]);
  }

  private run(script: string): unknown {
    return vm.runInContext(script, this.context, { timeout: 500 });
  }
}

// Key scripts come from their own seed, so a run's inputs are repeatable.
export function makeScript(seed: number, keys: number[] = [7, 9]): (step: number) => number {
  const rand = makeRand(seed ^ 0x5bd1e995);
  let until = 0;
  let mask = 0;
  return (step) => {
    if (step >= until) {
      until = step + 1 + (rand() % 24);
      const roll = rand();
      mask = roll < 40 ? 0 : roll < 200 ? 1 << keys[rand() % keys.length] : 1 << (rand() & 15);
    }
    return mask;
  };
}

export type Mismatch = {
  seed: number;
  step: number;
  keys: number[];
  pixelsDiffering: number;
  agreement: number;
  region: string;
  original: string;
  rewrite: string;
  registers: string;
  rewriteState: string;
};

export type VerifyResult = {
  runs: number;
  stepsPlanned: number;
  stepsMatched: number;
  cleanRuns: number;
  codeBytesReached: number;
  codeBytesTotal: number;
  framesPerStep: number;
  stepsBeforeMismatch: number[];
  firstScreenAgreement: number;
  mismatch: Mismatch | null;
};

const GLYPHS = [".", "#", "2", "3"];

// Renders part of a screen. Values: . off, # plane 1, 2 plane 2, 3 both planes.
const render = (
  pixels: ArrayLike<number>,
  w: number,
  h: number,
  x0 = 0,
  y0 = 0,
  x1 = w,
  y1 = h,
): string => {
  const rows: string[] = [];
  for (let y = y0; y < y1; y++) {
    let row = "";
    for (let x = x0; x < x1; x++) row += GLYPHS[pixels[y * w + x] & 3];
    rows.push(row);
  }
  return rows.join("\n");
};

const keysFromMask = (mask: number): number[] =>
  Array.from({ length: 16 }, (_, k) => k).filter((k) => mask & (1 << k));

export function verify(
  rom: Uint8Array,
  config: GameConfig,
  code: string,
  seeds: number[],
  stepsPerRun: number,
): VerifyResult {
  const sandbox = new Sandbox(code, rom);
  const syncPc = sandbox.syncPc;
  const reached = new Uint8Array(0x10000);
  const codeAddrs = [...findCode(rom).entries()];
  let matched = 0;
  let cleanRuns = 0;
  let frames = 0;
  let stepsRun = 0;
  let first: Mismatch | null = null;
  const stepsBeforeMismatch: number[] = [];
  let firstScreenTotal = 0;

  for (const seed of seeds) {
    const original = new Chip8(rom, { ticksPerFrame: config.ticksPerFrame, seed });
    if (!reachSync(original, syncPc, sandbox.startKeys)) {
      throw new Error(
        `The original never reached SYNC_PC 0x${hex(syncPc, 3)} while pressing START_KEYS`,
      );
    }
    sandbox.start(seed);
    const script = makeScript(seed, config.testKeys);
    let clean = true;
    let runMatched = 0;

    for (let step = 0; step <= stepsPerRun; step++) {
      let keys = 0;
      if (step > 0) {
        keys = script(step);
        const before = original.frame;
        if (!original.runUntil(syncPc, keys, 1200)) {
          throw new Error(`The original left SYNC_PC at step ${step} and never returned`);
        }
        frames += original.frame - before;
        stepsRun++;
        sandbox.step(keys);
      }
      const w = original.width;
      const h = original.height;
      const got = sandbox.pixels();
      let differing = got.length === w * h ? 0 : w * h;
      if (differing === 0) {
        for (let p = 0; p < w * h; p++) {
          if ((original.display[p] & 3) !== (got[p] & 3)) differing++;
        }
      }
      if (step === 0) firstScreenTotal += (w * h - differing) / (w * h);
      if (differing > 0) {
        if (!first) {
          // Crop around the differing pixels so large screens stay readable.
          let bx0 = 0;
          let by0 = 0;
          let bx1 = w - 1;
          let by1 = h - 1;
          if (got.length === w * h) {
            bx0 = w;
            by0 = h;
            bx1 = 0;
            by1 = 0;
            for (let p = 0; p < w * h; p++) {
              if ((original.display[p] & 3) === (got[p] & 3)) continue;
              const x = p % w;
              const y = Math.floor(p / w);
              bx0 = Math.min(bx0, x);
              by0 = Math.min(by0, y);
              bx1 = Math.max(bx1, x);
              by1 = Math.max(by1, y);
            }
          }
          const x0 = Math.max(0, bx0 - 4);
          const y0 = Math.max(0, by0 - 3);
          const x1 = Math.min(w, Math.max(bx1 + 5, x0 + 16), x0 + 72);
          const y1 = Math.min(h, Math.max(by1 + 4, y0 + 8), y0 + 28);
          first = {
            seed,
            step,
            keys: keysFromMask(keys),
            pixelsDiffering: differing,
            agreement: got.length === w * h ? (w * h - differing) / (w * h) : 0,
            region: `screen ${w}x${h}; differing pixels span x ${bx0}-${bx1}, y ${by0}-${by1}; crop shows x ${x0}-${x1 - 1}, y ${y0}-${y1 - 1}`,
            original: render(original.display, w, h, x0, y0, x1, y1),
            rewrite:
              got.length === w * h
                ? render(got, w, h, x0, y0, x1, y1)
                : `wrong size: ${got.length} values, expected ${w * h}`,
            registers: `pc=${hex(original.pc, 3)} i=${hex(original.i, 3)} ${[...original.v]
              .map((v, i) => `v${i.toString(16)}=${hex(v)}`)
              .join(" ")}`,
            rewriteState: JSON.stringify(sandbox.game.state()).slice(0, 1500),
          };
        }
        clean = false;
        break;
      }
      if (step > 0) {
        matched++;
        runMatched++;
      }
    }
    stepsBeforeMismatch.push(runMatched);
    if (clean) cleanRuns++;
    for (const [addr] of codeAddrs) if (original.coverage[addr]) reached[addr] = 1;
  }

  return {
    runs: seeds.length,
    stepsPlanned: seeds.length * stepsPerRun,
    stepsMatched: matched,
    cleanRuns,
    codeBytesReached: codeAddrs.filter(([addr]) => reached[addr]).length * 2,
    codeBytesTotal: codeAddrs.length * 2,
    framesPerStep: stepsRun ? frames / stepsRun : 0,
    stepsBeforeMismatch,
    firstScreenAgreement: firstScreenTotal / seeds.length,
    mismatch: first,
  };
}

export function describeResult(r: VerifyResult): string {
  const lines = [
    `Steps matched: ${r.stepsMatched}/${r.stepsPlanned} across ${r.runs} runs (${r.cleanRuns} runs fully clean).`,
    `Original code reached by these tests: ${r.codeBytesReached}/${r.codeBytesTotal} bytes.`,
    `Original takes ${r.framesPerStep.toFixed(2)} frames per step on average.`,
    `Steps matched in each run before its first mismatch: ${r.stepsBeforeMismatch.join(", ")}.`,
    `Opening screen (step 0) pixel agreement: ${(r.firstScreenAgreement * 100).toFixed(1)}%.`,
  ];
  if (r.mismatch) {
    const m = r.mismatch;
    lines.push(
      `FIRST MISMATCH: seed ${m.seed}, step ${m.step}, keys held [${m.keys}], ${m.pixelsDiffering} pixels differ (${(m.agreement * 100).toFixed(1)}% of the screen agrees).`,
      `Where: ${m.region}`,
      `Original at sync: ${m.registers}`,
      `Rewrite state: ${m.rewriteState}`,
      `Original (crop):\n${m.original}`,
      `Rewrite (crop):\n${m.rewrite}`,
    );
  } else {
    lines.push("No mismatches in these runs.");
  }
  return lines.join("\n");
}

export type ModReport = {
  steps: number;
  stepsWithDifferentScreens: number;
  changedValues: { name: string; firstStep: number; stepsDiffering: number; direct: boolean }[];
  unchangedValues: string[];
};

// Runs a checked rewrite and a modded copy side by side on the same inputs and
// reports which named game values changed. No original is involved: the
// baseline has already been checked against it.
export function compareMod(
  baselineCode: string,
  modCode: string,
  seeds: number[],
  stepsPerRun: number,
  testKeys: number[] = [7, 9],
  rom?: Uint8Array,
): ModReport {
  const base = new Sandbox(baselineCode, rom);
  const mod = new Sandbox(modCode, rom);
  const changed = new Map<string, { firstStep: number; stepsDiffering: number }>();
  const direct = new Set<string>();
  const seen = new Set<string>();
  let screens = 0;
  let total = 0;

  for (const seed of seeds) {
    base.start(seed);
    mod.start(seed);
    const script = makeScript(seed, testKeys);
    // A value is a direct change if, in some run, it is among the first to differ.
    // Values that only differ later are knock-on effects of an earlier change.
    let firstStepInRun = -1;
    for (let step = 0; step <= stepsPerRun; step++) {
      if (step > 0) {
        const keys = script(step);
        base.step(keys);
        mod.step(keys);
      }
      total++;
      const a = base.pixels();
      const b = mod.pixels();
      if (a.length !== b.length || a.some((v, i) => v !== b[i])) screens++;
      const sa = base.game.state() as Record<string, unknown>;
      const sb = mod.game.state() as Record<string, unknown>;
      for (const name of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
        seen.add(name);
        if (JSON.stringify(sa[name]) === JSON.stringify(sb[name])) continue;
        if (firstStepInRun < 0) firstStepInRun = step;
        if (step === firstStepInRun) direct.add(name);
        const entry = changed.get(name) ?? { firstStep: step, stepsDiffering: 0 };
        entry.stepsDiffering++;
        changed.set(name, entry);
      }
    }
  }

  return {
    steps: total,
    stepsWithDifferentScreens: screens,
    changedValues: [...changed.entries()].map(([name, e]) => ({
      name,
      ...e,
      direct: direct.has(name),
    })),
    unchangedValues: [...seen].filter((name) => !changed.has(name)),
  };
}

export function describeMod(r: ModReport): string {
  const lines = [
    `Compared ${r.steps} steps on identical inputs. Screens differed on ${r.stepsWithDifferentScreens}.`,
  ];
  if (r.changedValues.length === 0) lines.push("No named game values changed.");
  for (const c of r.changedValues) {
    const kind = c.direct ? "DIRECT CHANGE" : "KNOCK-ON CHANGE";
    lines.push(
      `${kind} ${c.name}: differs on ${c.stepsDiffering} steps, first at step ${c.firstStep}.`,
    );
  }
  lines.push(`Unchanged values: ${r.unchangedValues.join(", ") || "none"}.`);
  return lines.join("\n");
}

export class Lab {
  readonly rom: Uint8Array;
  readonly config: GameConfig;
  readonly coverage = new Uint8Array(0x10000);
  private machine: Chip8;

  constructor(game: string) {
    this.config = GAMES[game];
    if (!this.config) throw new Error(`Unknown game: ${game}`);
    this.rom = new Uint8Array(readFileSync(this.config.file));
    this.machine = this.fresh(1);
  }

  private fresh(seed: number): Chip8 {
    const c = new Chip8(this.rom, { ticksPerFrame: this.config.ticksPerFrame, seed });
    c.coverage = this.coverage;
    return c;
  }

  disassemble(start: number, end: number): string {
    return disassemble(this.rom, start, end, this.coverage).join("\n");
  }

  // Replays inputs from a fresh start, watching chosen memory and all registers.
  experiment(
    seed: number,
    inputs: InputSegment[],
    watch: number[],
    breakAt: number | undefined,
    showScreen = true,
  ): string {
    const c = this.fresh(seed);
    this.machine = c;
    const log: string[] = [];
    const registers = (): string =>
      [...c.v].map((v, i) => `v${i.toString(16)}=${hex(v)}`).join(" ");
    let previous = watch.map((a) => c.mem[a]);
    let hits = 0;

    for (const segment of inputs) {
      const mask = keyMask(segment.keys);
      for (let f = 0; f < segment.frames; f++) {
        if (breakAt !== undefined) {
          c.setKeys(mask);
          const end = c.frame + 1;
          while (c.frame < end && !c.halted) {
            const wasTick = c.frame;
            if (c.runUntil(breakAt, mask, 1) && hits < 40) {
              hits++;
              log.push(`break at frame ${c.frame}: pc=${hex(c.pc, 3)} i=${hex(c.i, 3)} ${registers()}`);
            }
            if (c.frame === wasTick && c.pc !== breakAt) break;
          }
        } else {
          c.runFrame(mask);
        }
        const now = watch.map((a) => c.mem[a]);
        now.forEach((value, n) => {
          if (value !== previous[n] && log.length < 80) {
            log.push(`frame ${c.frame}: mem[${hex(watch[n], 3)}] ${hex(previous[n])} -> ${hex(value)}`);
          }
        });
        previous = now;
        if (c.halted) break;
      }
    }

    return [
      `Finished at frame ${c.frame}. pc=${hex(c.pc, 3)} i=${hex(c.i, 3)} delay=${c.dt} buzzer=${c.st}`,
      `stack=[${c.stack.map((a) => hex(a, 3))}] hires=${c.hires} randomDraws=${c.randDraws} error=${c.error}`,
      `Registers: ${registers()}`,
      ...(log.length ? ["Log:", ...log] : []),
      ...(showScreen
        ? [
            `Screen ${c.width}x${c.height} (. off, # plane 1, 2 plane 2, 3 both):`,
            render(Array.from(c.display, (p) => p & 3), c.width, c.height),
          ]
        : []),
    ].join("\n");
  }

  // Hooks a machine so every screen operation is logged with its inputs.
  private trace(c: Chip8, sink: string[]): void {
    const step = c.step.bind(c);
    c.step = () => {
      const at = c.pc;
      const op = (c.mem[at] << 8) | c.mem[(at + 1) & 0xffff];
      const x = (op >> 8) & 0xf;
      const y = (op >> 4) & 0xf;
      let entry: string | null = null;
      if (op >> 12 === 0xd) {
        const n = op & 0xf;
        entry = `@${hex(at, 3)} draw x=${c.v[x]} y=${c.v[y]} ${n === 0 ? "16x16" : `8x${n}`} from=${hex(c.i, 4)} plane=${c.plane}`;
      } else if (op === 0x00e0) entry = `@${hex(at, 3)} clear plane=${c.plane}`;
      else if (op === 0x00fe || op === 0x00ff) entry = `@${hex(at, 3)} ${op === 0x00ff ? "hires" : "lores"} (clears screen)`;
      else if ((op & 0xfff0) === 0x00c0 || (op & 0xfff0) === 0x00d0 || op === 0x00fb || op === 0x00fc) {
        entry = `@${hex(at, 3)} scroll op=${hex(op, 4)} plane=${c.plane}`;
      } else if (op >> 12 === 0xc) entry = `@${hex(at, 3)} random into v${x.toString(16)}`;
      step();
      if (entry) {
        if (op >> 12 === 0xd) entry += ` vf=${c.v[0xf]}`;
        if (op >> 12 === 0xc) entry += ` = ${hex(c.v[x])}`;
        sink.push(entry);
      }
    };
  }

  // Everything drawn since the last full clear, up to the first SYNC_PC.
  traceToSync(seed: number, syncPc: number, startKeys: number[]): string {
    const c = this.fresh(seed);
    this.machine = c;
    const sink: string[] = [];
    this.trace(c, sink);
    if (!reachSync(c, syncPc, keyMask(startKeys))) {
      return `The original did not reach ${hex(syncPc, 3)} within 3000 frames while pressing [${startKeys}].`;
    }
    let from = 0;
    sink.forEach((e, k) => {
      if (/clear plane=3|clears screen/.test(e)) from = k;
    });
    const kept = sink.slice(from);
    return [
      `Reached ${hex(syncPc, 3)} at frame ${c.frame} after ${sink.length} screen operations. Showing ${Math.min(kept.length, 260)} of ${kept.length} since the last full clear.`,
      `At sync: i=${hex(c.i, 4)} ${[...c.v].map((v, k) => `v${k.toString(16)}=${hex(v)}`).join(" ")} randomDraws=${c.randDraws}`,
      ...kept.slice(-260),
    ].join("\n");
  }

  // What the original draws in each step after the first SYNC_PC.
  traceSteps(seed: number, syncPc: number, startKeys: number[], steps: number[][]): string {
    const c = this.fresh(seed);
    this.machine = c;
    if (!reachSync(c, syncPc, keyMask(startKeys))) {
      return `The original did not reach ${hex(syncPc, 3)} while pressing [${startKeys}].`;
    }
    const sink: string[] = [];
    this.trace(c, sink);
    const out: string[] = [];
    steps.slice(0, 30).forEach((keys, k) => {
      sink.length = 0;
      const before = c.frame;
      const ok = c.runUntil(syncPc, keyMask(keys), 1200);
      out.push(
        `step ${k + 1} keys [${keys}]: ${c.frame - before} frames${ok ? "" : " (did not return to sync)"}; ` +
          `registers ${[...c.v].map((v, n) => `v${n.toString(16)}=${hex(v)}`).join(" ")}`,
      );
      out.push(...sink.slice(0, 40).map((e) => `   ${e}`));
      if (sink.length > 40) out.push(`   ... ${sink.length - 40} more operations`);
    });
    return out.join("\n").slice(0, 13000);
  }

  // Finds a byte sequence in the ROM, for locating sprite or level data.
  findBytes(hexBytes: string): string {
    const bytes = (hexBytes.replace(/[^0-9a-f]/gi, "").match(/../g) ?? []).map((b) => parseInt(b, 16));
    if (bytes.length === 0) return "No bytes given.";
    const hits: string[] = [];
    for (let a = 0; a + bytes.length <= this.rom.length && hits.length < 30; a++) {
      if (bytes.every((b, k) => this.rom[a + k] === b)) hits.push(hex(a + 0x200, 4));
    }
    return hits.length ? `Found at: ${hits.join(" ")}` : "Not found.";
  }

  // Contiguous runs of code found by following jumps and calls, plus call targets.
  codeMap(): string {
    const code = findCode(this.rom);
    const addrs = [...code.keys()].sort((a, b) => a - b);
    const ranges: string[] = [];
    let start = addrs[0];
    let prev = addrs[0];
    let count = 1;
    const flush = (): void => {
      const end = prev + (code.get(prev) === 0xf000 ? 3 : 1);
      ranges.push(`${hex(start, 3)}-${hex(end, 3)} (${count})`);
    };
    for (const a of addrs.slice(1)) {
      if (a - prev <= 4) {
        prev = a;
        count++;
        continue;
      }
      flush();
      start = a;
      prev = a;
      count = 1;
    }
    flush();
    const targets = new Set<number>();
    for (const op of code.values()) if (op >> 12 === 2) targets.add(op & 0xfff);
    return [
      `ROM ${this.rom.length} bytes at 0x200-${hex(0x200 + this.rom.length - 1, 4)}. ${code.size} instructions found by following control flow; everything else is data or unreached code.`,
      `Code ranges (instruction count): ${ranges.join(", ")}`,
      `Subroutine entry points: ${[...targets].sort((a, b) => a - b).map((a) => hex(a, 3)).join(" ")}`,
    ].join("\n");
  }

  // Replays inputs and reports where execution time goes.
  profile(seed: number, inputs: InputSegment[]): string {
    const c = this.fresh(seed);
    this.machine = c;
    const counts = new Map<number, number>();
    const calls = new Map<number, number>();
    const step = c.step.bind(c);
    c.step = () => {
      counts.set(c.pc, (counts.get(c.pc) ?? 0) + 1);
      const op = (c.mem[c.pc] << 8) | c.mem[(c.pc + 1) & 0xffff];
      if (op >> 12 === 2) calls.set(op & 0xfff, (calls.get(op & 0xfff) ?? 0) + 1);
      step();
    };
    for (const segment of inputs) {
      const mask = keyMask(segment.keys);
      for (let f = 0; f < segment.frames && !c.halted; f++) c.runFrame(mask);
    }
    const top = (m: Map<number, number>, n: number): string =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([a, k]) => `${hex(a, 3)}:${k}`)
        .join(" ");
    return [
      `Ran ${c.frame} frames. pc=${hex(c.pc, 3)} randomDraws=${c.randDraws} error=${c.error}`,
      `Most-called subroutines (address:calls): ${top(calls, 20)}`,
      `Most-run instructions (address:count): ${top(counts, 30)}`,
    ].join("\n");
  }

  readMemory(address: number, length: number): string {
    const bytes = this.machine.mem.slice(address, address + Math.min(length, 256));
    return [...bytes].map((b) => hex(b)).join(" ");
  }
}

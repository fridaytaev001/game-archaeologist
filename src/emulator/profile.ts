// Counts how often each instruction runs, to find a game's main loop.
// Usage: node src/emulator/profile.ts <rom> <ticksPerFrame> <frames>
import { readFileSync } from "node:fs";
import { Chip8 } from "./chip8.ts";
import { findCode } from "./disasm.ts";

const [file, ticks, frames] = process.argv.slice(2);
const rom = new Uint8Array(readFileSync(file));
const c = new Chip8(rom, { ticksPerFrame: Number(ticks), seed: 7 });
const code = findCode(rom);
const counts = new Map<number, number>();
const calls = new Map<number, number>();
const original = c.step.bind(c);
c.step = () => {
  counts.set(c.pc, (counts.get(c.pc) ?? 0) + 1);
  const op = (c.mem[c.pc] << 8) | c.mem[c.pc + 1];
  if (op >> 12 === 2) calls.set(op & 0xfff, (calls.get(op & 0xfff) ?? 0) + 1);
  original();
};

let firstGameplayFrame = -1;
for (let f = 0; f < Number(frames); f++) {
  const start = f % 120 < 10 ? 1 << 6 : 0;
  const move = [5, 7, 8, 9][Math.floor(f / 25) % 4];
  c.runFrame(start | (1 << move));
  if (firstGameplayFrame < 0 && c.randDraws > 0) firstGameplayFrame = f;
}

const codeBytes = code.size * 2;
console.log(`ROM ${rom.length} bytes; code found by following jumps: ~${codeBytes} bytes in ${code.size} instructions`);
console.log(`first random draw at frame ${firstGameplayFrame}; error=${c.error}`);
console.log(`reached code: ${[...code.keys()].filter((a) => c.coverage[a]).length}/${code.size} instructions`);
console.log("\nMost-called subroutines:");
for (const [addr, n] of [...calls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${addr.toString(16)}: ${n}`);
}
console.log("\nInstructions run about once per frame (main-loop candidates):");
const perFrame = [...counts.entries()]
  .filter(([, n]) => n > Number(frames) * 0.5 && n < Number(frames) * 1.5)
  .sort((a, b) => a[0] - b[0]);
console.log(`  ${perFrame.map(([a, n]) => `${a.toString(16)}(${n})`).join(" ")}`);

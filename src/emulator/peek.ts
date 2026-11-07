// Prints a game's screen at chosen frames.
// Usage: node src/emulator/peek.ts <rom> <ticksPerFrame> <seed> <frames,comma,separated>
import { readFileSync } from "node:fs";
import { Chip8 } from "./chip8.ts";

const [file, ticks, seed, frames] = process.argv.slice(2);
const rom = new Uint8Array(readFileSync(file));
const c = new Chip8(rom, { ticksPerFrame: Number(ticks), seed: Number(seed) });
const wanted = new Set(frames.split(",").map(Number));
const last = Math.max(...wanted);

for (let f = 1; f <= last; f++) {
  const start = f % 90 < 10 ? 1 << 6 : 0;
  const move = [5, 7, 8, 9][Math.floor(f / 40) % 4];
  c.runFrame(start | (1 << move));
  if (wanted.has(f)) {
    console.log(`--- frame ${f} pc=${c.pc.toString(16)} hires=${c.hires} draws=${c.randDraws}`);
    console.log(c.ascii());
  }
}

const used = c.coveredBytes();
console.log(`error=${c.error} coverage=${used}/${rom.length} bytes`);

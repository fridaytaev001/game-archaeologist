// Prints a ROM's disassembly, marking executed instructions from a sample run.
// Usage: node src/emulator/dis.ts <rom> <ticksPerFrame> <frames>
import { readFileSync } from "node:fs";
import { Chip8 } from "./chip8.ts";
import { disassemble } from "./disasm.ts";

const [file, ticks, frames] = process.argv.slice(2);
const rom = new Uint8Array(readFileSync(file));
const c = new Chip8(rom, { ticksPerFrame: Number(ticks), seed: 7 });
for (let f = 0; f < Number(frames); f++) {
  c.runFrame(1 << [7, 9][Math.floor(f / 30) % 2]);
}
console.log(disassemble(rom, 0x200, 0x200 + rom.length, c.coverage).join("\n"));

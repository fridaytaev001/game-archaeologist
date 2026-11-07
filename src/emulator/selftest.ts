// Run: node src/emulator/selftest.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Chip8 } from "./chip8.ts";

const program = (...words: number[]): Uint8Array =>
  Uint8Array.from(words.flatMap((w) => [w >> 8, w & 0xff]));

const run = (rom: Uint8Array, steps: number): Chip8 => {
  const c = new Chip8(rom, { ticksPerFrame: 1, seed: 1 });
  for (let s = 0; s < steps; s++) c.step();
  return c;
};

test("add sets the carry flag after the result", () => {
  const c = run(program(0x60ff, 0x6102, 0x8014), 3);
  assert.equal(c.v[0], 1);
  assert.equal(c.v[0xf], 1);
});

test("subtract clears VF on borrow", () => {
  const c = run(program(0x6001, 0x6102, 0x8015), 3);
  assert.equal(c.v[0], 0xff);
  assert.equal(c.v[0xf], 0);
});

test("shift copies VY by default", () => {
  const c = run(program(0x6103, 0x8016), 2);
  assert.equal(c.v[0], 1);
  assert.equal(c.v[0xf], 1);
});

test("bcd stores three digits", () => {
  const c = run(program(0x60fe, 0xa300, 0xf033), 3);
  assert.deepEqual([...c.mem.slice(0x300, 0x303)], [2, 5, 4]);
});

test("save advances I by default", () => {
  const c = run(program(0x6007, 0x6108, 0xa300, 0xf155), 4);
  assert.deepEqual([...c.mem.slice(0x300, 0x302)], [7, 8]);
  assert.equal(c.i, 0x302);
});

test("a skip jumps over the whole long-load instruction", () => {
  const c = run(program(0x3000, 0xf000, 0x1234, 0x6042), 2);
  assert.equal(c.v[0], 0x42);
  assert.equal(c.i, 0);
});

test("long load sets a 16-bit I", () => {
  const c = run(program(0xf000, 0x1234), 1);
  assert.equal(c.i, 0x1234);
  assert.equal(c.pc, 0x204);
});

test("drawing twice erases and reports a collision", () => {
  const c = run(program(0xa000, 0xd015, 0xd015), 2);
  assert.equal(c.v[0xf], 0);
  assert.notEqual(c.ascii().trim(), "");
  c.step();
  assert.equal(c.v[0xf], 1);
  assert.equal(c.ascii().trim(), "");
});

test("sprites wrap at the screen edge by default", () => {
  const c = run(program(0x603f, 0xa000, 0xd015), 3);
  assert.equal(c.display[63], 1);
  assert.equal(c.display[0], 1);
});

test("wait-key resumes on a new press only", () => {
  const c = new Chip8(program(0xf30a, 0x6401), { ticksPerFrame: 4, seed: 1 });
  c.runFrame(0);
  assert.equal(c.waitReg, 3);
  c.runFrame(1 << 9);
  assert.equal(c.v[3], 9);
  assert.equal(c.v[4], 1);
});

test("unknown opcodes halt with an error", () => {
  const c = run(program(0x5001), 1);
  assert.equal(c.halted, true);
  assert.match(c.error ?? "", /unknown opcode/);
});

const games = [
  { file: "targets/br8kout.ch8", ticksPerFrame: 7 },
  { file: "targets/chickenScratch.ch8", ticksPerFrame: 500 },
];

const script = (frame: number): number => {
  const start = frame % 90 < 10 ? 1 << 6 : 0;
  const move = [5, 7, 8, 9][Math.floor(frame / 40) % 4];
  return start | (1 << move);
};

for (const game of games) {
  const rom = new Uint8Array(readFileSync(game.file));
  const play = (seed: number, frames: number): number[] => {
    const c = new Chip8(rom, { ticksPerFrame: game.ticksPerFrame, seed });
    const hashes: number[] = [];
    for (let f = 0; f < frames; f++) {
      c.runFrame(script(f));
      hashes.push(c.screenHash());
    }
    assert.equal(c.error, null, `${game.file}: ${c.error}`);
    return hashes;
  };

  test(`${game.file} repeats exactly with the same seed`, () => {
    assert.deepEqual(play(7, 900), play(7, 900));
  });

  test(`${game.file} resumes exactly from a saved state`, () => {
    const c = new Chip8(rom, { ticksPerFrame: game.ticksPerFrame, seed: 7 });
    for (let f = 0; f < 300; f++) c.runFrame(script(f));
    const saved = c.snapshot();
    const first: number[] = [];
    for (let f = 300; f < 600; f++) {
      c.runFrame(script(f));
      first.push(c.screenHash());
    }
    c.restore(saved);
    const second: number[] = [];
    for (let f = 300; f < 600; f++) {
      c.runFrame(script(f));
      second.push(c.screenHash());
    }
    assert.deepEqual(first, second);
  });
}

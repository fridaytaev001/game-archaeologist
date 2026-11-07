// Checks that the verifier accepts a correct rewrite and catches broken ones.
// Run: node --test src/lab/verifier.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkRewrite, compareMod, GAMES, verify } from "./lab.ts";

const rom = new Uint8Array(readFileSync(GAMES.br8kout.file));
const reference = readFileSync("src/lab/fixtures/br8kout.reference.js", "utf8");
const seeds = [3, 5, 8, 13, 21, 34, 55, 89];

test("the reference rewrite passes the static check", () => {
  assert.deepEqual(checkRewrite(reference), []);
});

test("the reference rewrite matches the original on every step", () => {
  const r = verify(rom, GAMES.br8kout, reference, seeds, 3000);
  assert.equal(r.mismatch, null, r.mismatch ? `step ${r.mismatch.step}` : "");
  assert.equal(r.stepsMatched, r.stepsPlanned);
  assert.ok(r.codeBytesReached === r.codeBytesTotal, `${r.codeBytesReached}/${r.codeBytesTotal}`);
});

test("a missing right-wall bounce is caught", () => {
  const broken = reference.replace("if (ballX === 0x3f) dx = 0xff;", "");
  const r = verify(rom, GAMES.br8kout, broken, seeds, 3000);
  assert.notEqual(r.mismatch, null);
});

test("a wrong paddle speed is caught", () => {
  const broken = reference.replace("paddleX = (paddleX + 4) & 0xff;", "paddleX = (paddleX + 3) & 0xff;");
  const r = verify(rom, GAMES.br8kout, broken, seeds, 3000);
  assert.notEqual(r.mismatch, null);
});

test("an emulator-style rewrite is rejected", () => {
  assert.ok(checkRewrite("const SYNC_PC=1; function createGame(){ let pc = 0x200; }").length > 0);
});

test("the mod report names only the value a mod changes", () => {
  const clamp = reference.replace(
    "paddleX = (paddleX + 4) & 0xff;",
    "paddleX = Math.min(paddleX + 4, 58);",
  ).replace(
    "paddleX = (paddleX + 0xfc) & 0xff;",
    "paddleX = Math.max(paddleX - 4, 0);",
  );
  const r = compareMod(reference, clamp, seeds, 1500);
  const names = r.changedValues.map((c) => c.name);
  assert.ok(names.includes("paddleX"), names.join(","));
});

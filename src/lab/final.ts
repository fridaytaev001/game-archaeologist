// Final test: fresh random seeds and inputs the agent has never seen.
// Run: node src/lab/final.ts <game> [runs] [steps]
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkRewrite, describeResult, GAMES, verify } from "./lab.ts";

const game = process.argv[2] ?? "br8kout";
const runs = Number(process.argv[3] ?? 30);
const steps = Number(process.argv[4] ?? 3000);
const config = GAMES[game];
const rom = new Uint8Array(readFileSync(config.file));
const code = readFileSync(`generated/${game}.js`, "utf8");

const problems = checkRewrite(code);
if (problems.length) {
  console.log(`Rewrite fails the static check: ${problems.join("; ")}`);
  process.exit(1);
}

const seeds = Array.from({ length: runs }, () => randomInt(1, 2 ** 31));
console.log(describeResult(verify(rom, config, code, seeds, steps)));

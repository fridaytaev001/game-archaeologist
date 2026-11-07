# Game Archaeologist

**Fix the game rule you hate, then prove nothing else changed.**

Game Archaeologist starts with a compiled game and no source code. A scientist agent powered by Meta's Muse Spark model investigates the binary through experiments, works out the game's rules, and writes them as readable JavaScript. A verifier runs the original and the rewrite in lockstep on inputs the agent has never seen and compares every pixel. The checked rewrite can then be remade with modern graphics and modded in plain English, and the verifier reports exactly which game values each mod changed.

Built for the AIE Code Summit 2026 Hackathon (Software Archaeology track) on November 7, 2026.

## Results so far

| Game | ROM | Agent result | Unseen test |
| --- | --- | --- | --- |
| Br8kout | 199 bytes, CHIP-8 | Readable rewrite after one verifier-caught correction | 90,000 of 90,000 steps matched across 30 runs, 196 of 196 code bytes reached |
| Slippery Slope | 2,482 bytes, CHIP-8 | Second run, with draw traces: opening screen 100% from the first rewrite; gameplay partly recovered (movement glide still wrong) | Opening screen 100% on 30 of 30 runs; 329 of 9,000 gameplay steps matched, with 16 of 30 runs matching some steps (up to 45) |
| Chicken Scratch | 17,024 bytes, XO-CHIP | Third run, with draw traces: opening screen went 90.1% → 98.5% → 100% across 11 rewrites; gameplay not yet recovered | Opening screen 100% pixel-perfect on 30 of 30 runs; 0 gameplay steps matched (first step 98.7% of pixels right) |

These numbers are measurements on finite tests, not proof that the versions are equivalent in every case.

**Where it stops today:** on Br8kout, about 100 instructions, the agent fully recovers the game. On games with roughly 700 to 1,200 instructions, the first runs failed: the agent read code for most turns and rarely tested a rewrite. Two harness changes made the difference. First, runtime draw traces show exactly which ROM sprites the original draws and where. Second, the verifier scores the share of matching pixels, and the agent is required to test a rewrite every few turns. With those changes, it reproduced both games' opening screens pixel-perfectly and recovered part of Slippery Slope's gameplay. Full gameplay recovery on the larger games is not solved, and we report it as a measured limit. All transcripts are in `runs/`.

**The correction moment (Br8kout):** the agent's first rewrite drew the ball as a 6-pixel sprite. The verifier reported 5 differing pixels on the opening screen. The agent traced the cause to the ball sprite being a single pixel, recorded that as a finding, fixed it, and then matched every step.

**The mod (Br8kout):** the original paddle wraps from one screen edge to the other. Asked to "make it stop at the walls", the mod builder changed only the paddle rule. The report lists the paddle position as the only direct change, and the ball's path as a knock-on change that begins once the ball reaches the clamped paddle.

## How it works

1. **Emulator harness** (`src/emulator/`): our own CHIP-8, SUPER-CHIP and XO-CHIP emulator. Runs are repeatable from a seed, with save and restore, memory and register access, and code coverage.
2. **Lab** (`src/lab/lab.ts`): the only way the agent can touch the game. It provides disassembly that follows control flow, experiments with key inputs and breakpoints, a code map and a profiler.
3. **Scientist agent** (`src/agent/run.ts`): Muse Spark runs a tool-calling loop. It records findings as Recovered, Observed, Inferred or Unresolved, then writes the rewrite.
4. **Verifier** (`src/lab/lab.ts`, `src/lab/final.ts`): steps the original to the top of its main loop, steps the rewrite with the same keys, and compares every pixel. It reports the first mismatch with a crop of both screens. Final tests use fresh random seeds and inputs.
5. **Rewrite rules:** the rewrite runs in a sandbox. A static check rejects emulators, program counters and code that reaches outside the sandbox. Sprite and level data may be copied from the ROM, but logic may not.
6. **Mod builder** (`src/agent/mod.ts`): Muse Spark edits the checked rewrite from a plain-English request. The rewrite and its mod run on identical inputs, and the report splits changed values into direct changes and knock-on changes.
7. **Demo** (`src/demo/`): the retro original and the modern remake run side by side in lockstep with a live match indicator. The remake is a drawing layer that only reads the rewrite's output, so it cannot change behavior.

The agent never sees the games' source code, descriptions or controls. `src/lab/fixtures/br8kout.reference.js` was hand-written by the team only to test the verifier. It is not agent output, and the agent never sees it.

## Run it

Requires Node.js 22.18 or later, which runs TypeScript directly. Put a Meta Model API key in `.env` as `META_API_KEY=...`.

```bash
node --test src/emulator/selftest.ts src/lab/verifier.test.ts
node src/agent/run.ts br8kout 40 4
node src/lab/final.ts br8kout 30 3000
node src/agent/mod.ts br8kout "Make the paddle stop at the walls instead of wrapping"
node src/demo/server.ts
```

Then open `http://127.0.0.1:5173/?game=br8kout`, adding `&mod=1` for the modded version. Agent transcripts and findings are saved in `runs/`.

## What was built during the hackathon

Everything in `src/`, `generated/` and `runs/`: the emulator, lab, verifier, agent, mod builder and demo, plus the agent-produced rewrites and logs. No prior code was used.

## Third-party material and credits

- **Games:** the ROMs in `targets/` come from the [chip8Archive](https://github.com/JohnEarnest/chip8Archive), which places its contents under CC0 1.0 (no rights reserved). Br8kout is by SharpenedSpoon and Chicken Scratch is by John Earnest. We credit them gladly.
- **Model:** Meta Muse Spark (`muse-spark-1.3`) through the Meta Model API.
- **REA:** not used.

## Team

Solo entry by Ali Zhumataev ([@fridaytaev001](https://github.com/fridaytaev001)).

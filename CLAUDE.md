# Meta 1 — Software Archaeology Hackathon

## Project context

We are exploring an entry for the AIE Code Summit 2026 Hackathon on November 7, 2026, in San Francisco. The chosen problem statement is **Software Archaeology**. We would also like to compete for **Best Use of Meta Model API ($5,000 cash)**.

The user wants an ambitious, visually impressive project featuring a playable 3D game or interactive world. They want a clear gap in an existing repository that they can explain to judges. Explain ideas in plain English and distinguish established facts from proposals.

This file records research and the current direction.

**Status (1:55 p.m. PT):** Br8kout works end to end. The agent's run is logged in `runs/br8kout/`. Its rewrite (`generated/br8kout.js`) matched 90,000 of 90,000 steps on unseen seeds, and the mod builder produced `generated/br8kout.mod.js`, which clamps the paddle. The demo is `node src/demo/server.ts` on port 5173 (`?game=br8kout`, add `&mod=1`). `src/lab/fixtures/br8kout.reference.js` is our own hand-written test fixture for the verifier, not agent output. The first Chicken Scratch and Slippery Slope runs failed. After adding draw traces, pixel-agreement scoring and forced iteration, the 2:45 p.m. PT unseen results were: Chicken Scratch, opening screen 100% on 30 of 30 runs and 0 gameplay steps; Slippery Slope, opening screen 100% on 30 of 30 runs and 329 of 9,000 gameplay steps. Present those two as partial results, never as working rewrites. The README describes the project and credits; the team section still needs names. The demo has an investigation timeline read from `/api/investigation`.

## Current direction (chosen November 7, 2026)

**This replaces World Archaeologist.** The sections below about Godot, the REA gap and the 3D world are earlier research, kept for reference. Where they conflict with this section, this section wins.

The project is an AI scientist that reverse engineers a real compiled game, rewrites it as readable code, and tests the rewrite against the original. Design doc: https://claude.ai/artifact/R9g8tNrDZ8aq8GQibqe4Kr

- **Main target:** Chicken Scratch by John Earnest, an XO-CHIP maze-chase game (17,024-byte ROM) from https://github.com/JohnEarnest/chip8Archive. The archive README places the repository under CC0.
- **Warm-up and fallbacks:** Br8kout (199 bytes) proves the pipeline first. Slippery Slope (2,482 bytes) is the middle fallback.
- **Decision point:** start Chicken Scratch at 3:15 p.m. PT only if Br8kout passes end to end.
- **Stack:** our own TypeScript emulator harness on Node, Meta's model as the agent, and a browser demo. Godot is not needed, and REA is optional. Node 24 is unpacked at `.tools/node/node-v24.22.2-win-x64/node.exe` (gitignored, not on the PATH) and runs `.ts` files directly. Run tests with `node --test src/emulator/selftest.ts`.
- **Use case:** players fix a rule they dislike in a game, then check that nothing else changed. The flow is rebuild, check, mod with Meta's model, then confirm with the verifier. It applies only to games whose license or owner allows it.
- **Modern remake:** the demo shows the retro original beside a modern remake. The remake is a separate drawing layer over the checked rules, so it cannot change behavior. A plain test renderer stays available for pixel comparison. New art must be original, generated or licensed.
- **Game rights:** a credit or disclaimer does not grant permission, so do not switch to a commercial game.
- **No Pac-Man:** we have no rights to it. Use Chicken Scratch's own name and art, and do not use the Pac-Man name in the pitch or demo.
- **Agent inputs:** the ROM, our disassembly and harness observations only. Keep `chicken.8o`, the archive's description, controls and gameplay GIF, and the final test seeds away from the agent. The source is for scoring only.
- **Rewrite rule:** sprites and maze data may be copied from the ROM, but logic may not. A static check must reject an embedded emulator or ROM code.
- **Claims:** report measured matches on unseen runs with coverage. Never claim full equivalence, or that the model had no prior knowledge of the game.
- **Meta API:** `muse-spark-1.3` at `https://api.meta.ai/v1/chat/completions` works with the key in `.env`, including a tool-calling round trip (`src/agent/smoke.ts`).
- **Not yet tested:** emulator accuracy against Octo, and whether Chicken Scratch is feasible in the time available.

## Official sources

- Participant guide: https://cerebralvalley.ai/e/aie-code-2026-hackathon/details
- REA repository: https://github.com/morluto/rea
- REA Godot support: https://github.com/morluto/rea/blob/main/docs/godot-pck.md
- REA reconstruction coverage: https://github.com/morluto/rea/blob/main/docs/reconstruction-coverage.md
- REA reconstruction obligation ledgers: https://github.com/morluto/rea/blob/main/docs/reference/reconstruction-obligation-ledgers.md
- REA environment quickstart: https://github.com/morluto/rea/blob/main/docs/agent-environments-quickstart.md
- Meta quickstart: https://dev.meta.ai/docs/quickstart
- Meta pricing: https://dev.meta.ai/docs/pricing-rate-limits

Research reflects the sources read on November 7, 2026. REA changes quickly; pin and inspect an exact commit before implementation. This was a documentation review, not a complete source-code or open-PR audit.

## Hackathon requirements

The Software Archaeology statement asks teams to recover, rebuild, port, or extend authorized software from incomplete evidence, including binaries, runtime traces, partial code, or documentation. The result should separate observed behavior from inferred behavior and provide behavioral evidence for reconstruction claims.

Other problem statements are The System That Gets Better and Trust but Verify. Sponsor awards are separate from these problem statements. The guide does not establish whether awards can be combined.

- Hacking scheduled for 10:45 a.m.–5 p.m. Pacific on November 7, 2026.
- Public repository required; maximum four team members; solo allowed.
- Submit an accessible one-minute demo video and identify all team members.
- Clearly distinguish work built during the hackathon from existing code. Attribute REA and preserve applicable license notices.
- Only use code, data, and assets we have rights to use.
- Banned examples include Streamlit apps, basic RAG apps, and projects whose main feature is a dashboard.
- First-round judging: impact 20%, technical demo 35%, creativity 15%, implementation difficulty 30%. Final-round categories have equal weighting.
- The detailed guide lists Meta's best-use prize as $5,000 cash. Recheck current organizer announcements for changes.

## What REA already provides

REA is an MCP/CLI toolkit for reverse engineering software, including native binaries, applications, and runtime behavior.

Existing capabilities relevant to this project include:

- Artifact inspection and extraction, including supported Godot PCK archives.
- Evidence records with provenance and limitations.
- Reconstruction obligation and coverage evaluation.
- Native analysis through supported external analysis engines.
- Recorded web-session environment building and behavior comparison.

Do not pitch generic evidence tracking, basic reconstruction comparison, or archive extraction as inventions of this project. REA already has substantial infrastructure in these areas.

## Verified gap relevant to a 3D project

REA's Godot PCK documentation describes archive inspection/extraction and explicitly excludes decoding Godot resources, decompiling GDScript bytecode, analyzing signals, and executing targets from that capability. It also does not decrypt encrypted contents or recover keys.

In plain English, extracting a game's files does not automatically recover an editable, playable game or establish how its interactions work.

**Proposed gap statement:**

> REA can unpack a game's files. We turn supported fragments into a playable world and test whether its interactions match the original.

This is a proposed extension to REA's documented Godot support. It is not a verified claim that every part of this workflow is absent everywhere in REA or that arbitrary games can be reconstructed automatically. Confirm the exact implementation gap against a pinned checkout and current issues/PRs.

## Proposed project: World Archaeologist

Recover an editable, playable 3D puzzle world from an authorized Godot export and incomplete evidence, using Meta models to investigate missing behavior.

### Proposed pipeline

1. **Excavate:** use REA to inventory and extract readable assets, scene/configuration files, and script fragments where available.
2. **Map:** implement a supported subset of scene/resource recovery and map objects and relationships.
3. **Investigate:** use Meta Model API to propose behavioral hypotheses and experiments that distinguish them.
4. **Rebuild:** generate an editable Godot project containing the recovered world and reconstructed interactions.
5. **Verify:** run repeatable action sequences against the original and reconstruction, retaining comparable observations and reporting mismatches.

Signals are Godot's event connections: for example, touching a switch causes a door to open. Recovering those connections is part of understanding behavior, not merely finding meshes or textures.

### Demo concept

Show original and reconstructed versions of a 3D puzzle world containing switches, doors, moving platforms, collectibles, and machinery.

An illustrative discovery: the agent initially assumes a door opens only while two switches remain pressed. An experiment shows the original remembers each activation after the player walks away. The agent revises the reconstructed rule, reruns the comparison, and a judge plays the recovered puzzle.

This is a proposed demo scenario, not an observed result or an existing selected game's behavior.

Object inspection could expose four evidence states inside the playable world:

- **Recovered:** directly read from an artifact, such as an object's position.
- **Observed:** demonstrated by an experiment against the original.
- **Inferred:** a proposed explanation that is not yet established.
- **Unresolved:** insufficient or conflicting evidence.

The playable reconstruction and discovery process are the main feature. Any interface should support them.

## Feasibility questions to answer first

- Select an authorized, redistributable game/export and confirm rights to publish extracted assets and derivative work.
- Inspect actual files before promising scene recovery. Packaged exports may contain compiled scripts and engine-specific resources rather than readable source scenes.
- Pick one Godot version and supported resource formats; test the parser/recovery path on the candidate immediately.
- Establish how we will control and observe the original game. An arbitrary export does not automatically expose positions, events, or deterministic input replay.
- Keep source code out of the reconstruction agent's inputs if claiming recovery without source. Source may be retained separately as evaluation ground truth.
- Decide which systems can be reconstructed and verified during the event. Aim for a compelling complete experience with explicit coverage, rather than claiming universal recovery.
- Use fresh action sequences for evaluation; replaying saved outputs alone does not establish reconstructed behavior.
- Separate visual resemblance, recovered structure, and behavioral agreement. Finite tests support specific claims, not universal equivalence.

## Proposed tools

| Tool | Purpose |
| --- | --- |
| REA, pinned version/commit | Artifact extraction, analysis, and evidence infrastructure |
| Godot | Execute the original/reconstruction and produce an editable 3D project |
| TypeScript / Node.js | REA extension and orchestration; check pinned REA runtime requirements |
| Meta Model API | Interpret evidence, propose experiments, and reconstruct missing behavior |
| Custom Godot test driver | Repeat inputs, capture observable outcomes, and compare versions |
| Git/public GitHub repository | Publish our contribution and distinguish it from upstream |

Meta's quickstart currently uses `muse-spark-1.3` with an OpenAI-compatible SDK and base URL `https://api.meta.ai/v1`. Verify model access and tool-loop behavior before relying on it. Keys belong in environment variables, never in this file or a public repository.

For a native-binary target, Ghidra plus its required Java runtime and a compiler/harness may be needed. Those are optional and should follow actual target requirements.

For the Meta prize, make Meta perform essential investigation within the submitted product. Merely using a coding assistant during development is a weaker sponsor story; this is strategic advice, not a published extra eligibility rule.

## Credits and setup

- **Priority: Meta's $100 Model API grant per accepted participant.** The participant guide says claims close November 7, 2026, at 3 p.m. Pacific. This is a historical event deadline; check whether it has passed before advising action.
- Claim link: https://docs.google.com/forms/d/e/1FAIpQLSdQuKkkBi-RT4ExsK96yonl-L8kwFvaFiT9xA43SnZqkRxVyA/viewform
- Requires an API account, completed billing verification, Team ID, and the same email used for acceptance. Participants must claim their own grants.
- The guide says to ask at the Meta booth if credits do not arrive in time. Promotional credits do not bypass billing verification. Wait for the credit balance before API calls if avoiding card charges.
- At the time checked, standard Muse Spark pricing was $1.25 per million input tokens and $4.25 per million output tokens. Actual cost depends on usage, including reasoning output; verify pricing and monitor spend.
- Subquadratic's advertised 100M promotional tokens are optional for large evidence investigations; not required for the initial proposed architecture.
- MongoDB's advertised $100 credits are not necessary for local evidence files.
- Local REA execution and Godot do not need model API credits. No rented GPU is required by the proposed architecture; local hardware still must support the chosen scene and tools.

## Earlier alternative, not the current preferred direction

We previously considered combining incomplete web-session recordings to reconstruct an API. Here, recording meant saved requests and responses, not necessarily video. REA's environment quickstart explicitly says combining separate sessions is unsupported. That is another documented opportunity, but the user prefers a visually impressive playable 3D world.

## Next useful step

Find and inspect a suitable Godot export, validate which resources are recoverable and how behavior can be observed, then choose the exact original contribution and demonstration. Do not present the proposed world reconstruction as already implemented or proven feasible.

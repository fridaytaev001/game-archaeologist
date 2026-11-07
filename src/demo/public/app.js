// Runs the original ROM and the agent's rewrite in lockstep: every time the
// original reaches the top of its main loop, the rewrite takes one step with the
// same keys and the two screens are compared.
import { Chip8, makeRand } from "/lib/chip8.js";

const GAMES = {
  br8kout: {
    title: "Br8kout",
    ticksPerFrame: 7,
    keys: { ArrowLeft: 7, KeyA: 7, ArrowRight: 9, KeyD: 9 },
    controls: "Left / right arrows move the paddle.",
    palette: ["#ca2553", "#ff84fe", "#ff84fe", "#ff84fe"],
  },
  slipperyslope: {
    title: "Slippery Slope",
    ticksPerFrame: 30,
    keys: { ArrowRight: 9, Space: 9, ArrowLeft: 7, ArrowUp: 5, ArrowDown: 8 },
    controls: "Right arrow or Space skates.",
    palette: ["powderblue", "navy", "#FF6600", "#662200"],
  },
  chickenScratch: {
    title: "Chicken Scratch",
    ticksPerFrame: 500,
    keys: { ArrowUp: 5, ArrowLeft: 7, ArrowDown: 8, ArrowRight: 9, Space: 6, Enter: 6 },
    controls: "Arrows move. Space starts.",
    palette: ["#D5A08C", "#7C4300", "#FD8100", "#FD8100"],
  },
};

const params = new URLSearchParams(location.search);
const gameId = params.get("game") ?? "br8kout";
const game = GAMES[gameId];
const useMod = params.get("mod") === "1";

const originalCanvas = document.getElementById("original");
const remakeCanvas = document.getElementById("remake");
const octx = originalCanvas.getContext("2d");
const light = document.getElementById("check-light");
const checkTitle = document.getElementById("check-title");
const checkDetail = document.getElementById("check-detail");
document.getElementById("controls").textContent = game.controls;

const held = new Set();
addEventListener("keydown", (e) => {
  if (game.keys[e.code] !== undefined) {
    held.add(game.keys[e.code]);
    e.preventDefault();
  }
});
addEventListener("keyup", (e) => held.delete(game.keys[e.code]));
const liveMask = () => [...held].reduce((m, k) => m | (1 << k), 0);

async function loadText(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

const rom = new Uint8Array(await (await fetch(`/targets/${gameId}.ch8`)).arrayBuffer());
const rewriteFile = useMod ? `/generated/${gameId}.mod.js` : `/generated/${gameId}.js`;
const rewriteCode = await loadText(rewriteFile);
const romCopy = rom.slice();
const { createGame, SYNC_PC, START_KEYS } = new Function(
  "ROM_BYTES",
  `${rewriteCode}\n;return { createGame, SYNC_PC, START_KEYS: typeof START_KEYS === "undefined" ? [] : START_KEYS };`,
)(romCopy);
const startMask = START_KEYS.reduce((m, k) => m | (1 << k), 0);

// Same as the verifier: press and release the start keys until the main loop.
function reachSync(c) {
  for (let f = 0; f < 3000; f++) {
    const keys = startMask && Math.floor(f / 10) % 2 === 0 ? startMask : 0;
    if (c.runUntil(SYNC_PC, keys, 1)) return true;
    if (c.halted) return false;
  }
  return false;
}

let remakeRenderer = null;
try {
  remakeRenderer = (await import(`/remakes/${gameId}.js`)).default;
} catch {
  remakeRenderer = null;
}

if (useMod) {
  document.getElementById("remake-title").textContent = "Modded remake";
  document.getElementById("remake-badge").textContent = "Your rule change, checked against the original";
}
const modButton = document.getElementById("mod-toggle");
fetch(`/generated/${gameId}.mod.js`, { method: "HEAD" }).then((r) => {
  if (!r.ok) return;
  modButton.hidden = false;
  modButton.textContent = useMod ? "Use original rules" : "Use mod";
});
modButton.onclick = () => {
  const next = new URLSearchParams(location.search);
  if (useMod) next.delete("mod");
  else next.set("mod", "1");
  location.search = next.toString();
};
document.getElementById("restart").onclick = () => start(Math.floor(Math.random() * 2 ** 31));

let original;
let remake;
let latched = 0;
let steps = 0;
let matching = 0;
let firstMismatch = null;
const renderState = { flashes: [] };

function start(seed) {
  original = new Chip8(rom, { ticksPerFrame: game.ticksPerFrame, seed });
  reachSync(original);
  remake = createGame(makeRand(seed));
  latched = 0;
  steps = 0;
  matching = 0;
  firstMismatch = null;
  renderState.flashes = [];
  remakeRenderer?.reset?.(renderState);
  compare();
}

function compare() {
  const pixels = remake.pixels();
  const n = original.width * original.height;
  let differing = 0;
  for (let p = 0; p < n; p++) if ((original.display[p] & 3) !== (pixels[p] & 3)) differing++;
  if (differing === 0) matching++;
  else firstMismatch ??= { step: steps, differing };
  return differing;
}

function tick() {
  const target = original.frame + 1;
  while (original.frame < target && !original.halted) {
    if (original.runUntil(SYNC_PC, latched, 1)) {
      remake.step(latched);
      steps++;
      latched = liveMask();
      compare();
    }
  }
}

function drawOriginal() {
  const w = original.width;
  const h = original.height;
  const cell = originalCanvas.width / w;
  octx.fillStyle = game.palette[0];
  octx.fillRect(0, 0, originalCanvas.width, originalCanvas.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = original.display[y * w + x] & 3;
      if (!v) continue;
      octx.fillStyle = game.palette[v];
      octx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

function drawRemakeFallback(ctx) {
  const w = remake.width;
  const h = remake.height;
  const cell = remakeCanvas.width / w;
  const pixels = remake.pixels();
  ctx.fillStyle = "#07080d";
  ctx.fillRect(0, 0, remakeCanvas.width, remakeCanvas.height);
  ctx.shadowColor = "#7c9cff";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#a9bcff";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y * w + x]) ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    }
  }
  ctx.shadowBlur = 0;
}

function drawCheck() {
  const ok = firstMismatch === null;
  light.className = `check-light ${ok ? "good" : "bad"}`;
  checkTitle.textContent = ok ? "Rules match the original" : "Behavior differs from the original";
  checkDetail.textContent = useMod
    ? `${matching} of ${steps + 1} steps identical. With a mod, differences are expected where the rule changed${
        firstMismatch ? `; first one at step ${firstMismatch.step}` : ""
      }.`
    : `${matching} of ${steps + 1} steps identical${
        firstMismatch ? `; first difference at step ${firstMismatch.step}` : ""
      }.`;
}

const rctx = remakeCanvas.getContext("2d");
let last = performance.now();
let carry = 0;
function loop(now) {
  carry += now - last;
  last = now;
  let runs = 0;
  while (carry >= 1000 / 60 && runs < 4) {
    tick();
    carry -= 1000 / 60;
    runs++;
  }
  if (runs === 4) carry = 0;
  drawOriginal();
  if (remakeRenderer) remakeRenderer.draw(rctx, remake, renderState, now);
  else drawRemakeFallback(rctx);
  drawCheck();
  requestAnimationFrame(loop);
}

async function showInvestigation() {
  const list = document.getElementById("timeline");
  const { run, events } = await (await fetch(`/api/investigation?game=${gameId}`)).json();
  if (!run) {
    list.innerHTML = "<li><span></span><span>No agent run recorded yet.</span></li>";
    return;
  }
  document.getElementById("investigation-source").textContent = `Run log ${run}`;
  const item = (labelClass, labelText, text, rowClass = "") => {
    const li = document.createElement("li");
    li.className = rowClass;
    const label = document.createElement("span");
    label.className = `label ${labelClass}`;
    label.textContent = labelText;
    const body = document.createElement("span");
    body.textContent = text;
    li.append(label, body);
    list.append(li);
  };
  for (const e of events) {
    if (e.type === "finding") {
      item(e.label, e.label, e.claim);
    } else if (e.type === "verify") {
      if (e.mismatch) {
        const pct = (v) => `${(v * 100).toFixed(1)}%`;
        const opening = e.openingAgreement == null ? "" : ` Opening screen ${pct(e.openingAgreement)} right.`;
        const where =
          e.mismatch.agreement == null
            ? `${e.mismatch.pixels} pixels`
            : `${e.mismatch.pixels} pixels wrong, ${pct(e.mismatch.agreement)} of the screen right`;
        item(
          "check-bad",
          "Mismatch",
          `Verifier: ${e.matched} of ${e.planned} steps matched.${opening} First difference at step ${e.mismatch.step}: ${where}.`,
          "verify-bad",
        );
      } else {
        item("check-good", "Match", `Verifier: ${e.matched} of ${e.planned} steps matched.`, "verify-good");
      }
    } else if (e.type === "finish") {
      item("done", "Summary", e.summary);
    }
  }
}
showInvestigation().catch(() => {});

start(Number(params.get("seed")) || Math.floor(Math.random() * 2 ** 31));
requestAnimationFrame(loop);

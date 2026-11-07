// Modern drawing layer for Br8kout. It only reads the rewrite's output, so it
// cannot change how the game behaves.

const COLS = 7;
const ROWS = 7;
const BRICK_X = (c) => 5 + 8 * c;
const BRICK_Y = (r) => 2 + 2 * r;
const BRICK_W = 6;
const PADDLE_W = 6;
const ROW_HUES = [330, 300, 265, 230, 200, 170, 140];

function read(game) {
  const w = game.width;
  const h = game.height;
  const px = game.pixels();
  const on = (x, y) => px[((y + h) % h) * w + ((x + w) % w)] !== 0;
  const claimed = new Uint8Array(w * h);

  const bricks = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let lit = 0;
      for (let dx = 0; dx < BRICK_W; dx++) if (on(BRICK_X(c) + dx, BRICK_Y(r))) lit++;
      const alive = lit >= BRICK_W - 1;
      bricks.push(alive);
      if (alive) for (let dx = 0; dx < BRICK_W; dx++) claimed[BRICK_Y(r) * w + BRICK_X(c) + dx] = 1;
    }
  }

  // The paddle is the longest lit run on the bottom rows, wrapping at the edges.
  let paddle = null;
  for (let y = h - 1; y >= h - 4 && !paddle; y--) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y) || on(x - 1, y)) continue;
      let run = 0;
      while (run < w && on(x + run, y)) run++;
      if (run >= PADDLE_W - 2) {
        paddle = { x, y, w: run };
        for (let k = 0; k < run; k++) claimed[y * w + ((x + k) % w)] = 1;
        break;
      }
    }
  }

  let ball = null;
  for (let y = 0; y < h && !ball; y++) {
    for (let x = 0; x < w; x++) {
      if (on(x, y) && !claimed[y * w + x]) {
        ball = { x, y };
        break;
      }
    }
  }
  return { bricks, paddle, ball, w, h };
}

export default {
  reset(state) {
    state.previousBricks = null;
    state.particles = [];
    state.trail = [];
  },

  draw(ctx, game, state, now) {
    const { bricks, paddle, ball, w, h } = read(game);
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const sx = W / w;
    const sy = H / h;

    // Background: deep gradient, faint grid and a soft vignette.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#120a2b");
    bg.addColorStop(1, "#04060f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(124,156,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 4) {
      ctx.beginPath();
      ctx.moveTo(x * sx, 0);
      ctx.lineTo(x * sx, H);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y * sy);
      ctx.lineTo(W, y * sy);
      ctx.stroke();
    }

    // A brick that vanished since the last frame bursts into particles.
    if (state.previousBricks) {
      bricks.forEach((alive, i) => {
        if (alive || !state.previousBricks[i]) return;
        const r = Math.floor(i / COLS);
        const c = i % COLS;
        const cx = (BRICK_X(c) + BRICK_W / 2) * sx;
        const cy = (BRICK_Y(r) + 0.5) * sy;
        for (let k = 0; k < 26; k++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1 + Math.random() * 4;
          state.particles.push({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1,
            life: 1,
            hue: ROW_HUES[r],
          });
        }
      });
    }
    state.previousBricks = bricks;

    // Bricks: rounded glass tiles with a glow and a highlight.
    bricks.forEach((alive, i) => {
      if (!alive) return;
      const r = Math.floor(i / COLS);
      const c = i % COLS;
      const x = BRICK_X(c) * sx;
      const y = BRICK_Y(r) * sy - sy * 0.15;
      const bw = BRICK_W * sx;
      const bh = sy * 1.3;
      const hue = ROW_HUES[r];
      ctx.save();
      ctx.shadowColor = `hsl(${hue} 100% 60%)`;
      ctx.shadowBlur = 16;
      const g = ctx.createLinearGradient(0, y, 0, y + bh);
      g.addColorStop(0, `hsl(${hue} 95% 72%)`);
      g.addColorStop(1, `hsl(${hue} 85% 45%)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, 5);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.roundRect(x + 4, y + 2, bw - 8, bh * 0.28, 3);
      ctx.fill();
    });

    // Ball trail and ball.
    if (ball) {
      state.trail.push({ x: (ball.x + 0.5) * sx, y: (ball.y + 0.5) * sy });
      if (state.trail.length > 14) state.trail.shift();
    }
    state.trail.forEach((p, k) => {
      const t = (k + 1) / state.trail.length;
      ctx.fillStyle = `rgba(160,220,255,${t * 0.35})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, sx * 0.55 * t, 0, Math.PI * 2);
      ctx.fill();
    });
    if (ball) {
      const bx = (ball.x + 0.5) * sx;
      const by = (ball.y + 0.5) * sy;
      ctx.save();
      ctx.shadowColor = "#9fe3ff";
      ctx.shadowBlur = 24;
      const g = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, sx * 0.8);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#58c4ff");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, sx * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Paddle: a neon capsule, drawn twice when it wraps past an edge.
    if (paddle) {
      const pulse = 0.75 + 0.25 * Math.sin(now / 300);
      const drawAt = (x) => {
        ctx.save();
        ctx.shadowColor = "#ffb86b";
        ctx.shadowBlur = 20 * pulse;
        const g = ctx.createLinearGradient(0, paddle.y * sy, 0, (paddle.y + 1) * sy);
        g.addColorStop(0, "#ffe2b8");
        g.addColorStop(1, "#ff8a3d");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x * sx, paddle.y * sy - sy * 0.2, paddle.w * sx, sy * 1.4, sy * 0.7);
        ctx.fill();
        ctx.restore();
      };
      drawAt(paddle.x);
      if (paddle.x + paddle.w > w) drawAt(paddle.x - w);
    }

    // Particles.
    state.particles = state.particles.filter((p) => p.life > 0);
    for (const p of state.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.life -= 0.025;
      ctx.fillStyle = `hsla(${p.hue} 100% 65% / ${p.life})`;
      ctx.fillRect(p.x, p.y, 3, 3);
    }

    // Vignette.
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  },
};

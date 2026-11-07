// Modern drawing layer for Chicken Scratch. It reads only the rewrite's pixels
// (two color planes), so it cannot change how the game behaves.

const PLANE_1 = [92, 46, 12]; // walls and outlines: dark chocolate
const PLANE_2 = [255, 150, 40]; // highlights: glowing orange
const BOTH = [255, 214, 120]; // overlap: warm gold

function layer(width, height) {
  const canvas = new OffscreenCanvas(width, height);
  return { canvas, ctx: canvas.getContext("2d"), image: new ImageData(width, height) };
}

export default {
  reset(state) {
    state.layers = null;
  },

  draw(ctx, game, state, now) {
    const w = game.width;
    const h = game.height;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const cw = W / w;
    const ch = H / h;
    const px = game.pixels();

    if (!state.layers || state.layers.w !== w) {
      state.layers = { w, all: layer(w, h), glow: layer(w, h) };
    }
    const { all, glow } = state.layers;
    const a = all.image.data;
    const g = glow.image.data;
    a.fill(0);
    g.fill(0);
    for (let p = 0; p < w * h; p++) {
      const v = px[p] & 3;
      if (!v) continue;
      a[p * 4 + 3] = 255;
      if (v & 2) {
        g[p * 4] = PLANE_2[0];
        g[p * 4 + 1] = PLANE_2[1];
        g[p * 4 + 2] = PLANE_2[2];
        g[p * 4 + 3] = 255;
      }
    }
    all.ctx.putImageData(all.image, 0, 0);
    glow.ctx.putImageData(glow.image, 0, 0);

    // Warm, softly lit floor.
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 20, W * 0.5, H * 0.5, W * 0.7);
    bg.addColorStop(0, "#f3d2b6");
    bg.addColorStop(1, "#b9876c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Soft drop shadow under everything that is drawn.
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.35;
    ctx.filter = "blur(3px) brightness(0)";
    ctx.drawImage(all.canvas, 4, 5, W, H);
    ctx.restore();

    // Crisp tiles with a top highlight and a darker lower edge, for depth.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = px[y * w + x] & 3;
        if (!v) continue;
        const c = v === 1 ? PLANE_1 : v === 2 ? PLANE_2 : BOTH;
        const X = x * cw;
        const Y = y * ch;
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.fillRect(X, Y, cw + 0.5, ch + 0.5);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(X, Y, cw + 0.5, ch * 0.3);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(X, Y + ch * 0.75, cw + 0.5, ch * 0.25);
      }
    }

    // Orange glow from the second color plane, gently pulsing.
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.45 + 0.15 * Math.sin(now / 400);
    ctx.filter = "blur(6px)";
    ctx.drawImage(glow.canvas, 0, 0, W, H);
    ctx.restore();

    // Vignette.
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
    v.addColorStop(0, "rgba(40,15,0,0)");
    v.addColorStop(1, "rgba(40,15,0,0.45)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  },
};

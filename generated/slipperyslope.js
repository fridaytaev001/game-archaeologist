const SYNC_PC = 0x4dc;
const START_KEYS = [];
function createGame(rand) {
  const W = 64, H = 32;
  let pix = new Array(W*H).fill(0);
  function drawSprite(x, y, addr, h) {
    for (let r = 0; r < h; r++) {
      const b = romByte(addr + r);
      for (let c = 0; c < 8; c++) {
        if ((b >> (7 - c)) & 1) {
          const xx = (x + c) % W, yy = (y + r) % H;
          pix[yy * W + xx] ^= 1;
        }
      }
    }
  }
  function romByte(a) {
    const o = a - 0x200;
    if (o < 0 || o >= ROM_BYTES.length) return 0;
    return ROM_BYTES[o];
  }
  function clearScreen() { pix.fill(0); }
  // working maze + positions
  let maze = new Array(72);
  for (let i = 0; i < 72; i++) maze[i] = romByte(0x209 + i);
  let gtx = romByte(0x251), gty = romByte(0x252);
  let ptx = romByte(0x253), pty = romByte(0x254);
  let vb = 3, v3 = 3, va = 0, v7 = 0, v6 = 0;
  let gx = gtx * 5 + 2, gy = gty * 5 + 1;
  // score memories (tracked but only affect intermediate score screens)
  let m202 = romByte(0x202), m203 = romByte(0x203);
  let m204 = romByte(0x204), m205 = romByte(0x205);

  function drawBordersAndMaze() {
    drawSprite(0, 1, 0x327, 15); drawSprite(62, 1, 0x327, 15);
    drawSprite(0, 16, 0x327, 15); drawSprite(62, 16, 0x327, 15);
    for (let x = 0; x < 64; x += 8) { drawSprite(x, 0, 0x325, 1); drawSprite(x, 31, 0x325, 1); }
    drawSprite(2, 1, 0x326, 1); drawSprite(61, 1, 0x326, 1);
    drawSprite(2, 30, 0x326, 1); drawSprite(61, 30, 0x326, 1);
    for (let col = 0; col < 12; col++) for (let row = 0; row < 6; row++) {
      drawSprite(2 + col * 5, 1 + row * 5, 0x34f + maze[col * 6 + row], 5);
    }
    gx = gtx * 5 + 2; gy = gty * 5 + 1;
    drawSprite(gx, gy, 0x336, 5);
    drawSprite(ptx * 5 + 2, pty * 5 + 1, 0x2ed + vb * 5, 5);
  }
  function redrawAfterLoad() {
    // call 3c2 behaviour: clear, borders+maze, ghost, reset vd/vc/vb/va/v7
    clearScreen();
    drawSprite(0, 1, 0x327, 15); drawSprite(62, 1, 0x327, 15);
    drawSprite(0, 16, 0x327, 15); drawSprite(62, 16, 0x327, 15);
    for (let x = 0; x < 64; x += 8) { drawSprite(x, 0, 0x325, 1); drawSprite(x, 31, 0x325, 1); }
    drawSprite(2, 1, 0x326, 1); drawSprite(61, 1, 0x326, 1);
    drawSprite(2, 30, 0x326, 1); drawSprite(61, 30, 0x326, 1);
    for (let col = 0; col < 12; col++) for (let row = 0; row < 6; row++) {
      drawSprite(2 + col * 5, 1 + row * 5, 0x34f + maze[col * 6 + row], 5);
    }
    gx = gtx * 5 + 2; gy = gty * 5 + 1;
    v7 = 0;
    vb = 3; va = 0;
    // vd,vc already set from gtx/gty/ptx/pty by caller (ptx,pty hold level start)
    drawSprite(gx, gy, 0x336, 5);
    drawSprite(ptx * 5 + 2, pty * 5 + 1, 0x2ed + vb * 5, 5);
  }
  function loadLevel(idx) {
    const base = 0x8ba + idx * 0x4c;
    for (let i = 0; i < 72; i++) maze[i] = romByte(base + i);
    gtx = romByte(base + 72); gty = romByte(base + 73);
    ptx = romByte(base + 74); pty = romByte(base + 75);
  }
  function ghostAnimDraw() {
    drawSprite(gx, gy, 0x33b + v7, 5);
    v7 += 5; if (v7 === 0x14) v7 = 0;
  }
  // boot: call 3c2 then title
  clearScreen();
  // inline 3c2 initial (vb=3, va=0, v7=0)
  drawSprite(0, 1, 0x327, 15); drawSprite(62, 1, 0x327, 15);
  drawSprite(0, 16, 0x327, 15); drawSprite(62, 16, 0x327, 15);
  for (let x = 0; x < 64; x += 8) { drawSprite(x, 0, 0x325, 1); drawSprite(x, 31, 0x325, 1); }
  drawSprite(2, 1, 0x326, 1); drawSprite(61, 1, 0x326, 1);
  drawSprite(2, 30, 0x326, 1); drawSprite(61, 30, 0x326, 1);
  for (let col = 0; col < 12; col++) for (let row = 0; row < 6; row++) {
    drawSprite(2 + col * 5, 1 + row * 5, 0x34f + maze[col * 6 + row], 5);
  }
  gx = gtx * 5 + 2; gy = gty * 5 + 1;
  drawSprite(gx, gy, 0x336, 5);
  drawSprite(ptx * 5 + 2, pty * 5 + 1, 0x2ed + vb * 5, 5);
  const top = [[14,0x2dd],[19,0x2c5],[23,0x2c1],[26,0x2d5],[31,0x2d5],[36,0x2b5],[41,0x2d9],[46,0x2e9]];
  for (const [x,a] of top) drawSprite(x,4,a,4);
  const bot = [[20,0x2dd],[25,0x2c5],[29,0x2d1],[34,0x2d5],[39,0x2b5]];
  for (const [x,a] of bot) drawSprite(x,24,a,4);

  return {
    width: W, height: H,
    pixels() { return pix.slice(); },
    state() { return { ptx, pty, vb, v6 }; },
    step(keys) {
      const held = (k) => (keys & (1 << k)) !== 0;
      if (held(9)) { va = 1; v3 = 0; }
      if (held(5)) { va = 1; v3 = 1; }
      if (held(7)) { va = 1; v3 = 2; }
      if (held(8)) { va = 1; v3 = 3; }
      if (va !== 1) {
        // attract / stopped; key6 reload only when v6!=0
        if (v6 !== 0 && held(6)) va = 3;
        if (va === 3) {
          // 077e: copy 202->204, reload level v6, redraw
          m204 = m202; m205 = m203;
          loadLevel(v6);
          redrawAfterLoad();
          return;
        }
        ghostAnimDraw();
        return;
      }
      // gameplay counters 0204/0205
      m205 += 1;
      if (m205 === 0x64) { m205 = 0; m204 += 1; }
      if (m204 === 0x64) { m204 = 0x63; m205 = 0x63; }
      // erase player at old pos
      {
        const px = ptx * 5 + 2, py = pty * 5 + 1;
        drawSprite(px, py, 0x2ed + vb * 5, 5);
        const t0 = maze[ptx * 6 + pty];
        if (t0 !== 0x23) drawSprite(px, py, 0x34f + t0, 5);
      }
      // slide loop (57a-730)
      for (;;) {
        vb = v3;
        const dxb = romByte(0x315 + vb * 2), dyb = romByte(0x315 + vb * 2 + 1);
        const dx = dxb > 127 ? dxb - 256 : dxb;
        const dy = dyb > 127 ? dyb - 256 : dyb;
        let ntx = ptx + dx, nty = pty + dy;
        if (ntx < 0 || ntx >= 12 || nty < 0 || nty >= 6) {
          va = 0;
          // keep ptx,pty (undo)
        } else {
          ptx = ntx; pty = nty;
        }
        // ghost collision (pixel compare)
        {
          const px = ptx * 5 + 2, py = pty * 5 + 1;
          if (px === gx && py === gy) va = 2;
        }
        let v1 = maze[ptx * 6 + pty];
        if (v1 === 0x05) {
          ptx -= dx; pty -= dy;
          // clamp back into range after double-undo edge case
          if (ptx < 0) ptx += 12; if (ptx >= 12) ptx -= 12;
          if (pty < 0) pty += 6; if (pty >= 6) pty -= 6;
          va = 0;
          v1 = maze[ptx * 6 + pty];
          // fall through with original v1? original keeps v1=0x05 for later checks.
          // To match original, restore v1 to 0x05 for subsequent comparisons:
          v1 = 0x05;
        }
        if (v1 === 0x0a) va = 3;
        if (v1 === 0x0f) vb = romByte(0x31d + vb);
        if (v1 === 0x14) vb = romByte(0x321 + vb);
        if (v1 === 0x19) {
          vb = romByte(0x31d + vb);
          const px = ptx * 5 + 2, py = pty * 5 + 1;
          drawSprite(px, py, 0x34f + v1, 5);
          maze[ptx * 6 + pty] = 0x1e;
          drawSprite(px, py, 0x34f + 0x1e, 5);
          v1 = 0;
        } else if (v1 === 0x1e) {
          vb = romByte(0x321 + vb);
          const px = ptx * 5 + 2, py = pty * 5 + 1;
          drawSprite(px, py, 0x34f + v1, 5);
          maze[ptx * 6 + pty] = 0x19;
          drawSprite(px, py, 0x34f + 0x19, 5);
          v1 = 0;
        }
        if (v1 === 0x23) {
          const px = ptx * 5 + 2, py = pty * 5 + 1;
          drawSprite(px, py, 0x34f + v1, 5);
          va = 0;
        }
        if (va !== 1) break;
        // draw player + ghost, erase player
        {
          const px = ptx * 5 + 2, py = pty * 5 + 1;
          drawSprite(px, py, 0x301 + vb * 5, 5);
          drawSprite(gx, gy, 0x33b + v7, 5);
          v7 += 5; if (v7 === 0x14) v7 = 0;
          // delay ignored
          drawSprite(px, py, 0x301 + vb * 5, 5);
        }
      }
      // final player draw 0732
      {
        const px = ptx * 5 + 2, py = pty * 5 + 1;
        drawSprite(px, py, 0x2ed + vb * 5, 5);
      }
      if (v6 !== 0 && held(6)) va = 3;
      if (va === 0) {
        ghostAnimDraw();
        return;
      }
      if (va === 3) {
        m204 = m202; m205 = m203;
        loadLevel(v6);
        redrawAfterLoad();
        return;
      }
      // va==2 death
      // intermediate score screens are cleared, so skip drawing them;
      // consume randoms as original (3 draws) and update v6/scores
      if (v6 === 0x0a) v6 += 1; else v6 = 1;
      // original draws scores/resets etc.; final effect on memories:
      // 0794 path resets 202/204 to 0 then increments 204; 083c path copies 204->202.
      // Since these don't affect final maze pixels, approximate:
      // consume randoms
      {
        const r4 = rand() & 0x03;
        const r2 = rand() & 0x3f;
        const r3 = rand() & 0x1f;
        void r4; void r2; void r3;
      }
      loadLevel(v6);
      redrawAfterLoad();
      return;
    }
  };
}

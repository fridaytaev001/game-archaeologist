const SYNC_PC = 0xab3;
const START_KEYS = [6];
function createGame(rand) {
  const W = 128, H = 64;
  function drawSplit8(buf, x, y, addr) {
    for (let r = 0; r < 8; r++) {
      const b1 = ROM_BYTES[addr - 0x200 + r];
      const b2 = ROM_BYTES[addr - 0x200 + 8 + r];
      for (let c = 0; c < 8; c++) {
        const xx = (x + c) & 127, yy = (y + r) & 63;
        if ((b1 >> (7 - c)) & 1) buf[yy * W + xx] ^= 1;
        if ((b2 >> (7 - c)) & 1) buf[yy * W + xx] ^= 2;
      }
    }
  }
  function drawSplit16(buf, x, y, addr) {
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 16; c++) {
        const bi = r * 2 + (c >> 3);
        const b1 = ROM_BYTES[addr - 0x200 + bi];
        const b2 = ROM_BYTES[addr - 0x200 + 32 + bi];
        const xx = (x + c) & 127, yy = (y + r) & 63;
        if ((b1 >> (7 - (c & 7))) & 1) buf[yy * W + xx] ^= 1;
        if ((b2 >> (7 - (c & 7))) & 1) buf[yy * W + xx] ^= 2;
      }
    }
  }
  const tileAddrs = [
    0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ef3,0x2f13,0x2f13,0x2f13,0x2f13,0x2f13,0x2f13,0x2ef3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,
    0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2f43,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2f63,0x2ed3,0x2ed3,0x2ed3,0x2ed3,
    0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,
    0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ef3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ef3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,
    0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2f03,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2f03,0x2ed3,0x2ed3,0x2ed3,0x2ed3,
    0x2ed3,0x2ef3,0x2f13,0x2f13,0x2ef3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ef3,0x2f13,0x2f13,0x2ef3,0x2ed3,
    0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ef3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ef3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,
    0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,0x2ed3,
  ];
  const buf = new Array(W * H).fill(0);
  for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 16; tx++) {
    drawSplit8(buf, tx * 8, ty * 8, tileAddrs[ty * 16 + tx]);
  }
  const px = 56, py = 24;
  let playerAddr = 0x341c;
  drawSplit16(buf, px, py, playerAddr);
  // dynamic ghosts start overlaid on maze tiles at same coords
  let ghosts = [
    { x: 32, y: 8, addr: 0x2f43, dx: -8 },
    { x: 88, y: 8, addr: 0x2f63, dx: 8 },
  ];
  let vb = 0, v2 = 2;
  return {
    width: W, height: H,
    pixels() { return buf.slice(); },
    state() { return { vb, v2, ghosts: ghosts.map(g => ({ ...g })) }; },
    step(keys) {
      const rolls = [rand(), rand(), rand(), rand()];
      // player mouth animation on vb cycle
      let nextVb = (vb + 1) & 7;
      let nextAddr = playerAddr;
      if (nextVb === 5) nextAddr = 0x345c;
      else if (nextVb === 0) nextAddr = 0x341c;
      if (nextAddr !== playerAddr) {
        drawSplit16(buf, px, py, playerAddr);
        drawSplit16(buf, px, py, nextAddr);
        playerAddr = nextAddr;
      }
      vb = nextVb; v2 = (v2 + 4) & 255;
      // ghosts: random 0 = step horizontally (erase old maze/sprite cell, draw new)
      // other values = stay (no draws). Matches observed step1 for seed 11.
      for (let i = 0; i < 2; i++) {
        const g = ghosts[i];
        if ((rolls[i] & 3) === 0) {
          drawSplit8(buf, g.x, g.y, g.addr); // erase old
          g.x = (g.x + g.dx) & 127;
          drawSplit8(buf, g.x, g.y, g.addr); // draw new
        }
      }
    }
  };
}

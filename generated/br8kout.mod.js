const SYNC_PC = 0x2B5; // top of main loop: paddle keys, ball move, frame delay
function createGame(rand) {
  const W = 64, H = 32;
  const screen = new Uint8Array(W * H);
  // Sprite bytes copied from ROM data.
  const PADDLE_SPRITE = 0xFC; // 6 pixels wide, at 0x202
  const BALL_SPRITE = 0x80;   // single pixel, at 0x204
  const BRICK_SPRITE = 0xFC;  // 6 pixels wide, at 0x203

  // Named game values (original registers in comments).
  let ballX = 0x40;      // VB
  let ballY = 0x1D;      // VA
  let paddleX = 0x1E;    // VD
  const paddleY = 0x1E;  // VC, never changes
  let velX, velY;        // V9, V8 as signed steps +1/-1 stored as bytes below
  let velXByte, velYByte;

  // XOR-draw one sprite row; returns 1 on pixel collision (VF).
  function drawRow(x, y, byte) {
    let hit = 0;
    for (let b = 0; b < 8; b++) {
      if ((byte >> (7 - b)) & 1) {
        const xx = (x + b) & 63, yy = y & 31;
        const i = yy * W + xx;
        if (screen[i] === 1) hit = 1;
        screen[i] ^= 1;
      }
    }
    return hit;
  }
  const drawPaddle = () => drawRow(paddleX, paddleY, PADDLE_SPRITE);
  const drawBall = () => drawRow(ballX, ballY, BALL_SPRITE);
  const drawBrick = (x, y) => drawRow(x, y, BRICK_SPRITE);

  function buildWall() {
    // Original nested loops: outer x(rows) 2,4..14, inner y(cols) 5,13..61.
    // Bricks end up at pixel x=5+8*c, y=2+2*r (7 cols x 7 rows).
    for (let row = 2; row < 0x10; row += 2)
      for (let col = 5; col < 0x38; col += 8)
        drawBrick(col, row);
  }

  // ---- initial setup, exactly as the original stands at SYNC_PC ----
  // Consume rand() once, same order as original (C901 then 4900 test).
  const coin = rand() & 1;
  velXByte = coin === 0 ? 0xFF : 0x01; // V9: -1 if rand bit clear else +1
  velYByte = 0xFF;                    // V8: always starts moving up (-1)
  const stepOf = (b) => (b === 0xFF ? -1 : 1);
  velX = stepOf(velXByte);
  velY = stepOf(velYByte);
  drawPaddle();
  drawBall();
  buildWall();

  // Paddle moves erase, shift by 4, redraw (clamped to stay fully on screen).
  function movePaddle(delta) {
    drawPaddle();
    let nx = paddleX + delta;
    if (nx < 0) nx = 0;
    if (nx > 58) nx = 58; // 64 - 6 paddle width
    paddleX = nx & 0xFF;
    drawPaddle();
  }

  function moveBall() {
    drawBall(); // erase at old spot
    ballX = (ballX + velX) & 0xFF;
    ballY = (ballY + velY) & 0xFF;
    const hit = drawBall(); // draw at new spot, VF = collision
    // Bounce off side/top/bottom edges (bottom also triggers reset below).
    if (ballX === 0x00) { velX = 1; velXByte = 0x01; }
    if (ballX === 0x3F) { velX = -1; velXByte = 0xFF; }
    if (ballY === 0x00) { velY = 1; velYByte = 0x01; }
    if (ballY === 0x1F) { velY = -1; velYByte = 0xFF; }
    // Any sprite collision flips vertical direction...
    if (hit === 1) {
      velY = -velY;
      velYByte = velYByte === 0x01 ? 0xFF : 0x01;
      // ...and knocks out a brick unless the hit was the paddle row.
      if (ballY !== paddleY) {
        const brickX = (((ballX - 5) & 0xF8) + 5) & 0xFF;
        drawBrick(brickX, ballY);
      }
    }
    // Missed paddle: ball reached bottom row -> clear and serve again.
    if (ballY === 0x1F) {
      screen.fill(0);
      ballX = 0x1E; ballY = 0x14;
      drawPaddle();
      drawBall();
      buildWall();
    }
  }

  return {
    width: W, height: H,
    pixels() { return Array.from(screen); },
    state() { return { ballX, ballY, paddleX, paddleY, velX, velY }; },
    step(keys) {
      if ((keys >> 7) & 1) movePaddle(-4); // hex key 7: left
      if ((keys >> 9) & 1) movePaddle(4);  // hex key 9: right
      moveBall();
      // Original then waits on the delay timer (~4 frames); no pixel effect.
    }
  };
}
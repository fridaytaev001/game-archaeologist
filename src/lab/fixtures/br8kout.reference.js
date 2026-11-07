// Hand-written by the team from the disassembly, only to test the verifier.
// This is not agent output, and the agent never sees it.
const SYNC_PC = 0x2b5;

function createGame(rand) {
  const W = 64;
  const H = 32;
  const KEY_LEFT = 7;
  const KEY_RIGHT = 9;
  const screen = new Array(W * H).fill(0);

  // XOR-draws one 8-pixel row and reports whether it erased a lit pixel.
  function sprite(x, y, bits) {
    let hit = 0;
    const x0 = x % W;
    const row = (y % H) * W;
    for (let c = 0; c < 8; c++) {
      if (!(bits & (0x80 >> c))) continue;
      const p = row + ((x0 + c) % W);
      if (screen[p]) hit = 1;
      screen[p] ^= 1;
    }
    return hit;
  }

  let paddleX = 30;
  const paddleY = 30;
  let ballX = 64; // starts one screen-width right, so it draws at x = 0
  let ballY = 29;
  let dx = rand() & 1 ? 1 : 0xff;
  let dy = 0xff;

  const drawPaddle = () => sprite(paddleX, paddleY, 0xfc);
  const drawBall = () => sprite(ballX, ballY, 0x80);
  const drawWall = () => {
    for (let y = 2; y < 16; y += 2) for (let x = 5; x < 56; x += 8) sprite(x, y, 0xfc);
  };

  drawPaddle();
  drawBall();
  drawWall();

  return {
    width: W,
    height: H,
    pixels: () => screen,
    state: () => ({ paddleX, ballX, ballY, dx, dy }),
    step(keys) {
      if (keys & (1 << KEY_LEFT)) {
        drawPaddle();
        paddleX = (paddleX + 0xfc) & 0xff;
        drawPaddle();
      }
      if (keys & (1 << KEY_RIGHT)) {
        drawPaddle();
        paddleX = (paddleX + 4) & 0xff;
        drawPaddle();
      }

      drawBall();
      ballX = (ballX + dx) & 0xff;
      ballY = (ballY + dy) & 0xff;
      const hit = drawBall();

      if (ballX === 0) dx = 1;
      if (ballX === 0x3f) dx = 0xff;
      if (ballY === 0) dy = 1;
      if (ballY === 0x1f) dy = 0xff;

      if (hit) {
        dy = dy === 1 ? 0xff : dy === 0xff ? 1 : dy;
        if (ballY !== paddleY) {
          const brickX = ((((ballX + 0xfb) & 0xff) & 0xf8) + 5) & 0xff;
          sprite(brickX, ballY, 0xfc);
        }
      }

      if (ballY === 0x1f) {
        screen.fill(0);
        ballX = 30;
        ballY = 20;
        drawPaddle();
        drawBall();
        drawWall();
      }
    },
  };
}

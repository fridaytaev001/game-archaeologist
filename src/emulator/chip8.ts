// CHIP-8 / SUPER-CHIP / XO-CHIP emulator built for experiments rather than play.
// Runs are repeatable: the same ROM, seed and key script always give the same run.

export type Quirks = {
  shift: boolean; // 8XY6/8XYE shift VX in place instead of copying VY
  loadStore: boolean; // FX55/FX65 leave I unchanged
  vfOrder: boolean; // write VF before the result instead of after it
  clip: boolean; // clip sprites at screen edges instead of wrapping
  jump: boolean; // BXNN jumps to XNN + VX instead of NNN + V0
  logic: boolean; // 8XY1/2/3 reset VF
};

export type Options = {
  ticksPerFrame: number;
  seed: number;
  quirks?: Partial<Quirks>;
};

export type Snapshot = {
  mem: Uint8Array;
  v: Uint8Array;
  i: number;
  pc: number;
  stack: number[];
  dt: number;
  st: number;
  plane: number;
  hires: boolean;
  display: Uint8Array;
  rng: number;
  randDraws: number;
  keys: number;
  waitReg: number;
  halted: boolean;
  error: string | null;
  frame: number;
  tick: number;
  pitch: number;
  pattern: Uint8Array;
  flags: Uint8Array;
};

const MAX_W = 128;
const MAX_H = 64;
const BIG_FONT_BASE = 0x50;

const SMALL_FONT = [
  0xf0, 0x90, 0x90, 0x90, 0xf0, 0x20, 0x60, 0x20, 0x20, 0x70, 0xf0, 0x10, 0xf0, 0x80, 0xf0,
  0xf0, 0x10, 0xf0, 0x10, 0xf0, 0x90, 0x90, 0xf0, 0x10, 0x10, 0xf0, 0x80, 0xf0, 0x10, 0xf0,
  0xf0, 0x80, 0xf0, 0x90, 0xf0, 0xf0, 0x10, 0x20, 0x40, 0x40, 0xf0, 0x90, 0xf0, 0x90, 0xf0,
  0xf0, 0x90, 0xf0, 0x10, 0xf0, 0xf0, 0x90, 0xf0, 0x90, 0x90, 0xe0, 0x90, 0xe0, 0x90, 0xe0,
  0xf0, 0x80, 0x80, 0x80, 0xf0, 0xe0, 0x90, 0x90, 0x90, 0xe0, 0xf0, 0x80, 0xf0, 0x80, 0xf0,
  0xf0, 0x80, 0xf0, 0x80, 0x80,
];

// Glyph shapes are from memory and not yet compared against Octo.
const BIG_FONT = [
  0x3c, 0x7e, 0xe7, 0xc3, 0xc3, 0xc3, 0xc3, 0xe7, 0x7e, 0x3c, 0x18, 0x38, 0x58, 0x18, 0x18,
  0x18, 0x18, 0x18, 0x18, 0x3c, 0x3e, 0x7f, 0xc3, 0x06, 0x0c, 0x18, 0x30, 0x60, 0xff, 0xff,
  0x3c, 0x7e, 0xc3, 0x03, 0x0e, 0x0e, 0x03, 0xc3, 0x7e, 0x3c, 0x06, 0x0e, 0x1e, 0x36, 0x66,
  0xc6, 0xff, 0xff, 0x06, 0x06, 0xff, 0xff, 0xc0, 0xc0, 0xfc, 0xfe, 0x03, 0xc3, 0x7e, 0x3c,
  0x3e, 0x7c, 0xc0, 0xc0, 0xfc, 0xfe, 0xc3, 0xc3, 0x7e, 0x3c, 0xff, 0xff, 0x03, 0x06, 0x0c,
  0x18, 0x30, 0x60, 0x60, 0x60, 0x3c, 0x7e, 0xc3, 0xc3, 0x7e, 0x7e, 0xc3, 0xc3, 0x7e, 0x3c,
  0x3c, 0x7e, 0xc3, 0xc3, 0x7f, 0x3f, 0x03, 0x03, 0x3e, 0x7c,
];

// The same byte stream the emulator's random instruction reads, so a rewrite can
// be given identical randomness.
export function makeRand(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    let x = state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    state = x >>> 0;
    return (state >>> 24) & 0xff;
  };
}

export class Chip8 {
  mem = new Uint8Array(0x10000);
  v = new Uint8Array(16);
  i = 0;
  pc = 0x200;
  stack: number[] = [];
  dt = 0;
  st = 0;
  plane = 1;
  hires = false;
  display = new Uint8Array(MAX_W * MAX_H); // bit 0 = plane 1, bit 1 = plane 2
  rng = 1;
  randDraws = 0;
  keys = 0;
  waitReg = -1;
  halted = false;
  error: string | null = null;
  frame = 0;
  tick = 0;
  pitch = 64;
  pattern = new Uint8Array(16);
  flags = new Uint8Array(16);
  coverage = new Uint8Array(0x10000); // survives reset, so it accumulates across runs

  readonly rom: Uint8Array;
  readonly ticksPerFrame: number;
  readonly quirks: Quirks;

  constructor(rom: Uint8Array, options: Options) {
    this.rom = rom;
    this.ticksPerFrame = options.ticksPerFrame;
    this.quirks = {
      shift: false,
      loadStore: false,
      vfOrder: false,
      clip: false,
      jump: false,
      logic: false,
      ...options.quirks,
    };
    this.reset(options.seed);
  }

  get width(): number {
    return this.hires ? MAX_W : 64;
  }

  get height(): number {
    return this.hires ? MAX_H : 32;
  }

  reset(seed: number): void {
    this.mem.fill(0);
    this.mem.set(SMALL_FONT, 0);
    this.mem.set(BIG_FONT, BIG_FONT_BASE);
    this.mem.set(this.rom, 0x200);
    this.v.fill(0);
    this.i = 0;
    this.pc = 0x200;
    this.stack = [];
    this.dt = 0;
    this.st = 0;
    this.plane = 1;
    this.hires = false;
    this.display.fill(0);
    this.rng = seed >>> 0 || 0x9e3779b9;
    this.randDraws = 0;
    this.keys = 0;
    this.waitReg = -1;
    this.halted = false;
    this.error = null;
    this.frame = 0;
    this.tick = 0;
    this.pitch = 64;
    this.pattern.fill(0);
    this.flags.fill(0);
  }

  snapshot(): Snapshot {
    return {
      mem: this.mem.slice(),
      v: this.v.slice(),
      i: this.i,
      pc: this.pc,
      stack: this.stack.slice(),
      dt: this.dt,
      st: this.st,
      plane: this.plane,
      hires: this.hires,
      display: this.display.slice(),
      rng: this.rng,
      randDraws: this.randDraws,
      keys: this.keys,
      waitReg: this.waitReg,
      halted: this.halted,
      error: this.error,
      frame: this.frame,
      tick: this.tick,
      pitch: this.pitch,
      pattern: this.pattern.slice(),
      flags: this.flags.slice(),
    };
  }

  restore(s: Snapshot): void {
    this.mem.set(s.mem);
    this.v.set(s.v);
    this.i = s.i;
    this.pc = s.pc;
    this.stack = s.stack.slice();
    this.dt = s.dt;
    this.st = s.st;
    this.plane = s.plane;
    this.hires = s.hires;
    this.display.set(s.display);
    this.rng = s.rng;
    this.randDraws = s.randDraws;
    this.keys = s.keys;
    this.waitReg = s.waitReg;
    this.halted = s.halted;
    this.error = s.error;
    this.frame = s.frame;
    this.tick = s.tick;
    this.pitch = s.pitch;
    this.pattern.set(s.pattern);
    this.flags.set(s.flags);
  }

  setKeys(keys: number): void {
    const pressed = keys & ~this.keys;
    this.keys = keys;
    if (this.waitReg >= 0 && pressed !== 0) {
      this.v[this.waitReg] = 31 - Math.clz32(pressed & -pressed);
      this.waitReg = -1;
    }
  }

  private advance(): void {
    if (!this.halted && this.waitReg < 0) this.step();
    this.tick++;
    if (this.tick >= this.ticksPerFrame) {
      this.tick = 0;
      if (this.dt > 0) this.dt--;
      if (this.st > 0) this.st--;
      this.frame++;
    }
  }

  // Runs to the next 60 Hz frame boundary. `keys` is a 16-bit mask of held keys,
  // bit N = hex key N.
  runFrame(keys: number): void {
    this.setKeys(keys);
    do this.advance();
    while (this.tick !== 0);
  }

  // Runs until the program counter reaches `pc`. Returns false if it never does
  // within `maxFrames`.
  runUntil(pc: number, keys: number, maxFrames: number): boolean {
    this.setKeys(keys);
    const limit = this.frame + maxFrames;
    do this.advance();
    while (this.pc !== pc && this.frame < limit && !this.halted);
    return this.pc === pc;
  }

  // FNV-1a over the visible screen, for quick frame comparison.
  screenHash(): number {
    let h = 0x811c9dc5;
    const n = this.width * this.height;
    for (let p = 0; p < n; p++) {
      h ^= this.display[p];
      h = Math.imul(h, 0x01000193);
    }
    return (h ^ (this.hires ? 1 : 0)) >>> 0;
  }

  ascii(): string {
    const glyphs = [" ", "#", "+", "@"];
    const rows: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let row = "";
      for (let x = 0; x < this.width; x++) row += glyphs[this.display[y * this.width + x] & 3];
      rows.push(row.trimEnd());
    }
    return rows.join("\n");
  }

  coveredBytes(start = 0x200, end = 0x200 + this.rom.length): number {
    let n = 0;
    for (let a = start; a < end; a++) if (this.coverage[a]) n++;
    return n;
  }

  private rand(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    this.randDraws++;
    return (this.rng >>> 24) & 0xff;
  }

  private word(addr: number): number {
    return (this.mem[addr & 0xffff] << 8) | this.mem[(addr + 1) & 0xffff];
  }

  private skip(): void {
    this.pc = (this.pc + (this.word(this.pc) === 0xf000 ? 4 : 2)) & 0xffff;
  }

  private fail(op: number, at: number): void {
    this.halted = true;
    this.error = `unknown opcode ${op.toString(16).padStart(4, "0")} at ${at.toString(16)}`;
  }

  private clearPlanes(): void {
    const keep = ~this.plane & 3;
    for (let p = 0; p < this.display.length; p++) this.display[p] &= keep;
  }

  private setMode(hires: boolean): void {
    this.hires = hires;
    this.display.fill(0);
  }

  // Moves selected planes by (dx, dy); pixels pushed off the edge are lost.
  private scroll(dx: number, dy: number): void {
    const w = this.width;
    const h = this.height;
    const old = this.display.slice(0, w * h);
    const mask = this.plane & 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x - dx;
        const sy = y - dy;
        const src = sx >= 0 && sx < w && sy >= 0 && sy < h ? old[sy * w + sx] : 0;
        const p = y * w + x;
        this.display[p] = (old[p] & ~mask) | (src & mask);
      }
    }
  }

  private draw(x: number, y: number, n: number): void {
    const w = this.width;
    const h = this.height;
    const big = n === 0;
    const rows = big ? 16 : n;
    const bytesPerRow = big ? 2 : 1;
    const cols = big ? 16 : 8;
    const x0 = this.v[x] % w;
    const y0 = this.v[y] % h;
    let addr = this.i;
    let collided = 0;
    for (let bit = 1; bit <= 2; bit <<= 1) {
      if ((this.plane & bit) === 0) continue;
      for (let r = 0; r < rows; r++) {
        const line = big
          ? this.word(addr + r * 2)
          : this.mem[(addr + r) & 0xffff] << 8;
        for (let c = 0; c < cols; c++) {
          if ((line & (0x8000 >> c)) === 0) continue;
          let px = x0 + c;
          let py = y0 + r;
          if (this.quirks.clip && (px >= w || py >= h)) continue;
          px %= w;
          py %= h;
          const p = py * w + px;
          if (this.display[p] & bit) collided = 1;
          this.display[p] ^= bit;
        }
      }
      addr += rows * bytesPerRow;
    }
    this.v[0xf] = collided;
  }

  private setWithFlag(x: number, value: number, flag: number): void {
    if (this.quirks.vfOrder) {
      this.v[0xf] = flag;
      this.v[x] = value;
    } else {
      this.v[x] = value;
      this.v[0xf] = flag;
    }
  }

  step(): void {
    const at = this.pc;
    const op = this.word(at);
    this.coverage[at] = 1;
    this.coverage[(at + 1) & 0xffff] = 1;
    this.pc = (at + 2) & 0xffff;

    const x = (op >> 8) & 0xf;
    const y = (op >> 4) & 0xf;
    const n = op & 0xf;
    const nn = op & 0xff;
    const nnn = op & 0xfff;
    const v = this.v;

    switch (op >> 12) {
      case 0x0:
        if (op === 0x00e0) this.clearPlanes();
        else if (op === 0x00ee) {
          const ret = this.stack.pop();
          if (ret === undefined) {
            this.halted = true;
            this.error = `return with empty stack at ${at.toString(16)}`;
          } else this.pc = ret;
        } else if ((op & 0xfff0) === 0x00c0) this.scroll(0, n);
        else if ((op & 0xfff0) === 0x00d0) this.scroll(0, -n);
        else if (op === 0x00fb) this.scroll(4, 0);
        else if (op === 0x00fc) this.scroll(-4, 0);
        else if (op === 0x00fd) this.halted = true;
        else if (op === 0x00fe) this.setMode(false);
        else if (op === 0x00ff) this.setMode(true);
        else this.fail(op, at);
        break;
      case 0x1:
        this.pc = nnn;
        break;
      case 0x2:
        this.stack.push(this.pc);
        this.pc = nnn;
        break;
      case 0x3:
        if (v[x] === nn) this.skip();
        break;
      case 0x4:
        if (v[x] !== nn) this.skip();
        break;
      case 0x5:
        if (n === 0) {
          if (v[x] === v[y]) this.skip();
        } else if (n === 2 || n === 3) {
          const dir = x <= y ? 1 : -1;
          const count = Math.abs(x - y);
          for (let k = 0; k <= count; k++) {
            const reg = x + k * dir;
            const addr = (this.i + k) & 0xffff;
            if (n === 2) this.mem[addr] = v[reg];
            else v[reg] = this.mem[addr];
          }
        } else this.fail(op, at);
        break;
      case 0x6:
        v[x] = nn;
        break;
      case 0x7:
        v[x] = (v[x] + nn) & 0xff;
        break;
      case 0x8:
        this.alu(op, at, x, y, n);
        break;
      case 0x9:
        if (n !== 0) this.fail(op, at);
        else if (v[x] !== v[y]) this.skip();
        break;
      case 0xa:
        this.i = nnn;
        break;
      case 0xb:
        this.pc = (nnn + v[this.quirks.jump ? x : 0]) & 0xffff;
        break;
      case 0xc:
        v[x] = this.rand() & nn;
        break;
      case 0xd:
        this.draw(x, y, n);
        break;
      case 0xe:
        if (nn === 0x9e) {
          if (this.keys & (1 << (v[x] & 0xf))) this.skip();
        } else if (nn === 0xa1) {
          if (!(this.keys & (1 << (v[x] & 0xf)))) this.skip();
        } else this.fail(op, at);
        break;
      case 0xf:
        this.misc(op, at, x, nn);
        break;
    }
  }

  private alu(op: number, at: number, x: number, y: number, n: number): void {
    const v = this.v;
    const a = v[x];
    const b = v[y];
    switch (n) {
      case 0x0:
        v[x] = b;
        break;
      case 0x1:
        v[x] = a | b;
        if (this.quirks.logic) v[0xf] = 0;
        break;
      case 0x2:
        v[x] = a & b;
        if (this.quirks.logic) v[0xf] = 0;
        break;
      case 0x3:
        v[x] = a ^ b;
        if (this.quirks.logic) v[0xf] = 0;
        break;
      case 0x4:
        this.setWithFlag(x, (a + b) & 0xff, a + b > 0xff ? 1 : 0);
        break;
      case 0x5:
        this.setWithFlag(x, (a - b) & 0xff, a >= b ? 1 : 0);
        break;
      case 0x6: {
        const src = this.quirks.shift ? a : b;
        this.setWithFlag(x, src >> 1, src & 1);
        break;
      }
      case 0x7:
        this.setWithFlag(x, (b - a) & 0xff, b >= a ? 1 : 0);
        break;
      case 0xe: {
        const src = this.quirks.shift ? a : b;
        this.setWithFlag(x, (src << 1) & 0xff, (src >> 7) & 1);
        break;
      }
      default:
        this.fail(op, at);
    }
  }

  private misc(op: number, at: number, x: number, nn: number): void {
    const v = this.v;
    const mem = this.mem;
    if (op === 0xf000) {
      this.i = this.word(this.pc);
      this.coverage[this.pc] = 1;
      this.coverage[(this.pc + 1) & 0xffff] = 1;
      this.pc = (this.pc + 2) & 0xffff;
      return;
    }
    switch (nn) {
      case 0x01:
        this.plane = x & 3;
        break;
      case 0x02:
        for (let k = 0; k < 16; k++) this.pattern[k] = mem[(this.i + k) & 0xffff];
        break;
      case 0x07:
        v[x] = this.dt;
        break;
      case 0x0a:
        this.waitReg = x;
        break;
      case 0x15:
        this.dt = v[x];
        break;
      case 0x18:
        this.st = v[x];
        break;
      case 0x1e:
        this.i = (this.i + v[x]) & 0xffff;
        break;
      case 0x29:
        this.i = (v[x] & 0xf) * 5;
        break;
      case 0x30:
        this.i = BIG_FONT_BASE + (v[x] & 0xf) * 10;
        break;
      case 0x33:
        mem[this.i & 0xffff] = Math.floor(v[x] / 100);
        mem[(this.i + 1) & 0xffff] = Math.floor(v[x] / 10) % 10;
        mem[(this.i + 2) & 0xffff] = v[x] % 10;
        break;
      case 0x3a:
        this.pitch = v[x];
        break;
      case 0x55:
        for (let k = 0; k <= x; k++) mem[(this.i + k) & 0xffff] = v[k];
        if (!this.quirks.loadStore) this.i = (this.i + x + 1) & 0xffff;
        break;
      case 0x65:
        for (let k = 0; k <= x; k++) v[k] = mem[(this.i + k) & 0xffff];
        if (!this.quirks.loadStore) this.i = (this.i + x + 1) & 0xffff;
        break;
      case 0x75:
        for (let k = 0; k <= x; k++) this.flags[k] = v[k];
        break;
      case 0x85:
        for (let k = 0; k <= x; k++) v[k] = this.flags[k];
        break;
      default:
        this.fail(op, at);
    }
  }
}

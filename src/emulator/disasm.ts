// Linear disassembler. Data bytes decode as nonsense, so callers should use
// coverage from real runs to tell executed code from data.

const hex = (n: number, width: number): string => n.toString(16).padStart(width, "0");

export function decode(op: number, next: number): string {
  const x = hex((op >> 8) & 0xf, 1);
  const y = hex((op >> 4) & 0xf, 1);
  const n = op & 0xf;
  const nn = hex(op & 0xff, 2);
  const nnn = hex(op & 0xfff, 3);
  switch (op >> 12) {
    case 0x0:
      if (op === 0x00e0) return "clear";
      if (op === 0x00ee) return "return";
      if ((op & 0xfff0) === 0x00c0) return `scroll-down ${n}`;
      if ((op & 0xfff0) === 0x00d0) return `scroll-up ${n}`;
      if (op === 0x00fb) return "scroll-right";
      if (op === 0x00fc) return "scroll-left";
      if (op === 0x00fd) return "exit";
      if (op === 0x00fe) return "lores";
      if (op === 0x00ff) return "hires";
      break;
    case 0x1:
      return `jump ${nnn}`;
    case 0x2:
      return `call ${nnn}`;
    case 0x3:
      return `skip if v${x} == ${nn}`;
    case 0x4:
      return `skip if v${x} != ${nn}`;
    case 0x5:
      if (n === 0) return `skip if v${x} == v${y}`;
      if (n === 2) return `save v${x}-v${y}`;
      if (n === 3) return `load v${x}-v${y}`;
      break;
    case 0x6:
      return `v${x} := ${nn}`;
    case 0x7:
      return `v${x} += ${nn}`;
    case 0x8: {
      const names: Record<number, string> = {
        0x0: ":=",
        0x1: "|=",
        0x2: "&=",
        0x3: "^=",
        0x4: "+=",
        0x5: "-=",
        0x6: ">>=",
        0x7: "=-",
        0xe: "<<=",
      };
      if (names[n]) return `v${x} ${names[n]} v${y}`;
      break;
    }
    case 0x9:
      if (n === 0) return `skip if v${x} != v${y}`;
      break;
    case 0xa:
      return `i := ${nnn}`;
    case 0xb:
      return `jump0 ${nnn}`;
    case 0xc:
      return `v${x} := random & ${nn}`;
    case 0xd:
      return `sprite v${x} v${y} ${n}`;
    case 0xe:
      if ((op & 0xff) === 0x9e) return `skip if key v${x}`;
      if ((op & 0xff) === 0xa1) return `skip if not key v${x}`;
      break;
    case 0xf: {
      if (op === 0xf000) return `i := long ${hex(next, 4)}`;
      const names: Record<number, string> = {
        0x01: `plane ${x}`,
        0x02: "audio",
        0x07: `v${x} := delay`,
        0x0a: `v${x} := wait-key`,
        0x15: `delay := v${x}`,
        0x18: `buzzer := v${x}`,
        0x1e: `i += v${x}`,
        0x29: `i := hex v${x}`,
        0x30: `i := bighex v${x}`,
        0x33: `bcd v${x}`,
        0x3a: `pitch := v${x}`,
        0x55: `save v0-v${x}`,
        0x65: `load v0-v${x}`,
        0x75: `saveflags v0-v${x}`,
        0x85: `loadflags v0-v${x}`,
      };
      const name = names[op & 0xff];
      if (name) return name;
      break;
    }
  }
  return `data ${hex(op, 4)}`;
}

// Follows jumps, calls and skips from the entry point, because CHIP-8 code can
// start on odd addresses and sit between data. Extra entry points can be supplied
// from addresses seen at run time, such as computed jumps.
export function findCode(rom: Uint8Array, extraEntries: number[] = []): Map<number, number> {
  const byteAt = (addr: number): number => rom[addr - 0x200] ?? 0;
  const word = (addr: number): number => (byteAt(addr) << 8) | byteAt(addr + 1);
  const inRom = (addr: number): boolean => addr >= 0x200 && addr < 0x200 + rom.length;
  const code = new Map<number, number>();
  const work = [0x200, ...extraEntries];

  while (work.length > 0) {
    let addr = work.pop() as number;
    while (inRom(addr) && !code.has(addr)) {
      const op = word(addr);
      const size = op === 0xf000 ? 4 : 2;
      code.set(addr, op);
      const top = op >> 12;
      const low = op & 0xff;
      const isSkip =
        top === 0x3 ||
        top === 0x4 ||
        top === 0x9 ||
        (top === 0x5 && (op & 0xf) === 0) ||
        (top === 0xe && (low === 0x9e || low === 0xa1));
      if (top === 0x1) {
        addr = op & 0xfff;
        continue;
      }
      if (top === 0x2) work.push(op & 0xfff);
      if (op === 0x00ee || op === 0x00fd || top === 0xb) break;
      if (isSkip) work.push(addr + size + (word(addr + size) === 0xf000 ? 4 : 2));
      addr += size;
    }
  }
  return code;
}

export function disassemble(
  rom: Uint8Array,
  start = 0x200,
  end = 0x200 + rom.length,
  coverage?: Uint8Array,
  extraEntries: number[] = [],
): string[] {
  const code = findCode(rom, extraEntries);
  const byteAt = (addr: number): number => rom[addr - 0x200] ?? 0;
  const lines: string[] = [];
  let addr = start;
  while (addr < end) {
    const mark = coverage ? (coverage[addr] ? "*" : " ") : "";
    const op = code.get(addr);
    if (op !== undefined) {
      const next = (byteAt(addr + 2) << 8) | byteAt(addr + 3);
      lines.push(`${mark}${hex(addr, 4)}: ${hex(op, 4)}  ${decode(op, next)}`);
      addr += op === 0xf000 ? 4 : 2;
      continue;
    }
    const bytes: string[] = [];
    const first = addr;
    while (addr < end && !code.has(addr) && bytes.length < 8) {
      bytes.push(hex(byteAt(addr), 2));
      addr++;
    }
    lines.push(` ${hex(first, 4)}: data ${bytes.join(" ")}`);
  }
  return lines;
}

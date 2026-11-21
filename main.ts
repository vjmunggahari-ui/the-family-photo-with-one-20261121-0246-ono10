// The Family Photo With One Machine Member — entry program.
// Renders one deterministic 1024x1024 PNG to $MAKEFUN_OUTPUT_DIR/entry.png.
// Node 22 stdlib only, no network, no randomness outside a fixed seed.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---- fixed-seed PRNG (mulberry32) ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- colour helpers ----
type RGB = [number, number, number];
function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
function shade(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

// ---- canvas ----
class Canvas {
  data: Float32Array;
  constructor() {
    this.data = new Float32Array(W * H * 3);
  }
  idx(x: number, y: number): number {
    return (y * W + x) * 3;
  }
  set(x: number, y: number, c: RGB, a = 1): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = this.idx(x, y);
    const d = this.data;
    d[i] = d[i] * (1 - a) + c[0] * a;
    d[i + 1] = d[i + 1] * (1 - a) + c[1] * a;
    d[i + 2] = d[i + 2] * (1 - a) + c[2] * a;
  }
  get(x: number, y: number): RGB {
    const i = this.idx(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
    const xa = Math.max(0, Math.floor(x0));
    const xb = Math.min(W - 1, Math.ceil(x1));
    const ya = Math.max(0, Math.floor(y0));
    const yb = Math.min(H - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) this.set(x, y, c, a);
  }
  // vertical gradient rect
  vgrad(x0: number, y0: number, x1: number, y1: number, top: RGB, bot: RGB): void {
    const ya = Math.max(0, Math.floor(y0));
    const yb = Math.min(H - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      this.rect(x0, y, x1, y, mix(top, bot, t));
    }
  }
  // horizontal gradient rect
  hgrad(x0: number, y0: number, x1: number, y1: number, left: RGB, right: RGB): void {
    const xa = Math.max(0, Math.floor(x0));
    const xb = Math.min(W - 1, Math.ceil(x1));
    for (let x = xa; x <= xb; x++) {
      const t = (x - x0) / Math.max(1, x1 - x0);
      this.rect(x, y0, x, y1, mix(left, right, t));
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
    const xa = Math.max(0, Math.floor(cx - rx));
    const xb = Math.min(W - 1, Math.ceil(cx + rx));
    const ya = Math.max(0, Math.floor(cy - ry));
    const yb = Math.min(H - 1, Math.ceil(cy + ry));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d <= 1) {
          // soft 1px edge
          const edge = d > 0.92 ? (1 - d) / 0.08 : 1;
          this.set(x, y, c, a * Math.max(0, Math.min(1, edge)));
        }
      }
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    this.ellipse(cx, cy, r, r, c, a);
  }
  // rounded rect
  rrect(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB, a = 1): void {
    this.rect(x0 + r, y0, x1 - r, y1, c, a);
    this.rect(x0, y0 + r, x1, y1 - r, c, a);
    this.ellipse(x0 + r, y0 + r, r, r, c, a);
    this.ellipse(x1 - r, y0 + r, r, r, c, a);
    this.ellipse(x0 + r, y1 - r, r, r, c, a);
    this.ellipse(x1 - r, y1 - r, r, r, c, a);
  }
  // filled polygon (scanline)
  poly(pts: [number, number][], c: RGB, a = 1): void {
    let minY = H;
    let maxY = 0;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
          const t = (y - p1[1]) / (p2[1] - p1[1]);
          xs.push(p1[0] + t * (p2[0] - p1[0]));
        }
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.floor(xs[k]));
        const xb = Math.min(W - 1, Math.ceil(xs[k + 1]));
        for (let x = xa; x <= xb; x++) this.set(x, y, c, a);
      }
    }
  }
  // thick line (as a quad strip, rounded caps)
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (w / 2);
    const ny = (dx / len) * (w / 2);
    this.poly(
      [
        [x0 + nx, y0 + ny],
        [x1 + nx, y1 + ny],
        [x1 - nx, y1 - ny],
        [x0 - nx, y0 - ny],
      ],
      c,
      a,
    );
    this.circle(x0, y0, w / 2, c, a);
    this.circle(x1, y1, w / 2, c, a);
  }
  // radial glow, additive-ish blend
  glow(cx: number, cy: number, r: number, c: RGB, strength: number): void {
    const xa = Math.max(0, Math.floor(cx - r));
    const xb = Math.min(W - 1, Math.ceil(cx + r));
    const ya = Math.max(0, Math.floor(cy - r));
    const yb = Math.min(H - 1, Math.ceil(cy + r));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1) {
          const a = strength * (1 - d) * (1 - d);
          this.set(x, y, c, a);
        }
      }
    }
  }
  // separable box blur, radius r (integer), passes n
  blur(r: number, passes: number): void {
    const tmp = new Float32Array(W * H * 3);
    const src = this.data;
    for (let p = 0; p < passes; p++) {
      // horizontal
      for (let y = 0; y < H; y++) {
        let s0 = 0;
        let s1 = 0;
        let s2 = 0;
        const row = y * W * 3;
        for (let x = -r; x <= r; x++) {
          const cx = Math.min(W - 1, Math.max(0, x));
          s0 += src[row + cx * 3];
          s1 += src[row + cx * 3 + 1];
          s2 += src[row + cx * 3 + 2];
        }
        for (let x = 0; x < W; x++) {
          const n = 2 * r + 1;
          tmp[row + x * 3] = s0 / n;
          tmp[row + x * 3 + 1] = s1 / n;
          tmp[row + x * 3 + 2] = s2 / n;
          const xo = Math.min(W - 1, Math.max(0, x - r));
          const xn = Math.min(W - 1, Math.max(0, x + r + 1));
          s0 += src[row + xn * 3] - src[row + xo * 3];
          s1 += src[row + xn * 3 + 1] - src[row + xo * 3 + 1];
          s2 += src[row + xn * 3 + 2] - src[row + xo * 3 + 2];
        }
      }
      // vertical
      for (let x = 0; x < W; x++) {
        let s0 = 0;
        let s1 = 0;
        let s2 = 0;
        for (let y = -r; y <= r; y++) {
          const cy = Math.min(H - 1, Math.max(0, y));
          s0 += tmp[(cy * W + x) * 3];
          s1 += tmp[(cy * W + x) * 3 + 1];
          s2 += tmp[(cy * W + x) * 3 + 2];
        }
        for (let y = 0; y < H; y++) {
          const n = 2 * r + 1;
          const i = (y * W + x) * 3;
          src[i] = s0 / n;
          src[i + 1] = s1 / n;
          src[i + 2] = s2 / n;
          const yo = Math.min(H - 1, Math.max(0, y - r));
          const yn = Math.min(H - 1, Math.max(0, y + r + 1));
          s0 += tmp[(yn * W + x) * 3] - tmp[(yo * W + x) * 3];
          s1 += tmp[(yn * W + x) * 3 + 1] - tmp[(yo * W + x) * 3 + 1];
          s2 += tmp[(yn * W + x) * 3 + 2] - tmp[(yo * W + x) * 3 + 2];
        }
      }
    }
  }
  // film grain, deterministic
  grain(rng: () => number, amt: number): void {
    const d = this.data;
    for (let i = 0; i < d.length; i++) {
      const n = (rng() - 0.5) * 2 * amt;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
    }
  }
  // warm grade + vignette
  grade(): void {
    const d = this.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const dx = (x - W / 2) / (W / 2);
        const dy = (y - H / 2) / (H / 2);
        const v = 1 - 0.16 * (dx * dx + dy * dy);
        d[i] = Math.max(0, Math.min(255, d[i] * 1.03 * v + 4));
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] * 1.0 * v + 1));
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] * 0.96 * v));
      }
    }
  }
  toBytes(): Buffer {
    const out = Buffer.alloc(W * H * 3);
    const d = this.data;
    for (let i = 0; i < d.length; i++) {
      const q = Math.round(Math.max(0, Math.min(255, d[i])) / 4) * 4;
      out[i] = Math.max(0, Math.min(255, q));
    }
    return out;
  }
}

// ---- PNG encoder (filter per row by libpng-style heuristic) ----
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function encodePNG(rgb: Buffer): Buffer {
  const bpp = 3;
  const raw = Buffer.alloc(H * (1 + W * bpp));
  const prev = Buffer.alloc(W * bpp);
  for (let y = 0; y < H; y++) {
    const row = rgb.subarray(y * W * bpp, (y + 1) * W * bpp);
    // try filters 0,1,2,3,4; pick smallest sum of |signed byte|
    let bestF = 0;
    let bestScore = Infinity;
    let bestRow: Buffer | null = null;
    for (let f = 0; f <= 4; f++) {
      const fr = Buffer.alloc(W * bpp);
      let score = 0;
      for (let x = 0; x < W * bpp; x++) {
        const left = x >= bpp ? row[x - bpp] : 0;
        const up = prev[x];
        const upLeft = x >= bpp ? prev[x - bpp] : 0;
        let v: number;
        if (f === 0) v = row[x];
        else if (f === 1) v = row[x] - left;
        else if (f === 2) v = row[x] - up;
        else if (f === 3) v = row[x] - ((left + up) >> 1);
        else v = row[x] - paeth(left, up, upLeft);
        fr[x] = v & 255;
        const s = v & 255;
        score += s < 128 ? s : 256 - s;
      }
      if (score < bestScore) {
        bestScore = score;
        bestF = f;
        bestRow = fr;
      }
    }
    const off = y * (1 + W * bpp);
    raw[off] = bestF;
    (bestRow as Buffer).copy(raw, off + 1);
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ================= SCENE =================
const C = {
  wallTop: rgb("#EFDDBB"),
  wallBot: rgb("#DDBF97"),
  floor: rgb("#8A5A36"),
  floorDark: rgb("#6E4527"),
  rug: rgb("#A94A33"),
  rugField: rgb("#C07A4E"),
  rugLine: rgb("#E8C88F"),
  couch: rgb("#A85A34"),
  couchDark: rgb("#7E3F22"),
  couchLight: rgb("#C97A4A"),
  cushion: rgb("#B96A3E"),
  skyTop: rgb("#4E6A94"),
  skyBot: rgb("#E9A86C"),
  curtain: rgb("#5C6E58"),
  curtainDark: rgb("#44523F"),
  lampGlow: rgb("#FFC46B"),
  lampShade: rgb("#F2C078"),
  skinDad: rgb("#C98E6B"),
  skinMum: rgb("#E2AC80"),
  skinKid: rgb("#EFB98C"),
  hairDad: rgb("#3E2C20"),
  hairMum: rgb("#6E3B22"),
  hairKid: rgb("#8A5A33"),
  sweaterDad: rgb("#3F5A52"),
  cardiganMum: rgb("#B4552D"),
  shirtKid: rgb("#E8E0C8"),
  stripeKid: rgb("#7A9BA8"),
  robotBody: rgb("#F0E7D3"),
  robotTeal: rgb("#3E7C7A"),
  robotDark: rgb("#D8CBB0"),
  apron: rgb("#D9A441"),
  apronDark: rgb("#B9822E"),
  wood: rgb("#7A4E2A"),
  woodLight: rgb("#9A6B40"),
  paper: rgb("#F4EDDC"),
  carrot: rgb("#E07B2E"),
  dogFur: rgb("#C08A52"),
  white: rgb("#F7F2E6"),
  black: rgb("#2A2320"),
};

function drawRoom(cv: Canvas): void {
  // walls
  cv.vgrad(0, 0, W, 660, C.wallTop, C.wallBot);
  // warm light wash from the lamp side (right)
  cv.hgrad(0, 0, W, 660, rgb("#E8D2AC"), rgb("#F4DDB2"));
  cv.glow(880, 300, 420, C.lampGlow, 0.16);
  // cool dusk wash from window side (left)
  cv.glow(180, 240, 380, rgb("#7E96B8"), 0.14);
  // baseboard
  cv.rect(0, 640, W, 668, rgb("#C9A87A"));
  cv.rect(0, 640, W, 646, rgb("#E4CDA3"));
  // floor
  cv.vgrad(0, 668, W, H, C.floor, C.floorDark);
  // floor planks
  for (let i = 0; i < 9; i++) {
    const y = 668 + i * 38;
    cv.rect(0, y, W, y + 2, rgb("#5E3A20"), 0.5);
  }
  for (let i = 0; i < 7; i++) {
    const x = 60 + i * 150 + (i % 2) * 70;
    cv.line(x, 668, x - 40, H, 2, rgb("#5E3A20"), 0.35);
  }
  // rug
  cv.ellipse(512, 880, 470, 130, C.rug);
  cv.ellipse(512, 880, 440, 112, C.rugField);
  cv.ellipse(512, 880, 400, 92, C.rug, 0.55);
  cv.ellipse(512, 880, 380, 80, C.rugField);
  // rug border dashes
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * Math.PI * 2;
    const x = 512 + Math.cos(t) * 420;
    const y = 880 + Math.sin(t) * 100;
    cv.circle(x, y, 4, C.rugLine, 0.8);
  }

  // ---- window (left) with dusk sky ----
  cv.rrect(56, 84, 348, 470, 10, rgb("#F7F2E6"));
  cv.vgrad(72, 100, 332, 454, C.skyTop, C.skyBot);
  // sun low on horizon
  cv.glow(300, 400, 90, rgb("#FFD9A0"), 0.9);
  cv.circle(300, 402, 26, rgb("#FFE3B0"));
  // distant rooftops
  cv.poly(
    [
      [72, 454],
      [72, 400],
      [120, 372],
      [168, 400],
      [210, 378],
      [262, 408],
      [300, 386],
      [332, 410],
      [332, 454],
    ],
    rgb("#5A4A68"),
    0.85,
  );
  // window cross frame
  cv.rect(196, 100, 208, 454, rgb("#F7F2E6"));
  cv.rect(72, 268, 332, 280, rgb("#F7F2E6"));
  // window sill
  cv.rrect(48, 470, 356, 486, 4, rgb("#EFE3C8"));
  // curtains
  cv.poly(
    [
      [30, 60],
      [96, 60],
      [86, 480],
      [40, 480],
    ],
    C.curtain,
  );
  cv.poly(
    [
      [312, 60],
      [378, 60],
      [368, 480],
      [322, 480],
    ],
    C.curtain,
  );
  for (let i = 0; i < 5; i++) {
    cv.line(44 + i * 10, 70, 52 + i * 9, 470, 3, C.curtainDark, 0.5);
    cv.line(330 + i * 9, 70, 338 + i * 8, 470, 3, C.curtainDark, 0.5);
  }
  cv.rect(24, 52, 384, 64, C.wood);

  // ---- radiator under window + laundry draped over it ----
  cv.rrect(70, 500, 340, 600, 6, rgb("#E8E0CE"));
  for (let i = 0; i < 9; i++) {
    cv.rect(84 + i * 28, 508, 92 + i * 28, 592, rgb("#CFC2A8"));
  }
  // laundry: a white tea towel + a terracotta cloth draped over the top
  cv.poly(
    [
      [96, 496],
      [170, 496],
      [164, 560],
      [104, 560],
    ],
    rgb("#F7F2E6"),
  );
  cv.poly(
    [
      [196, 496],
      [268, 496],
      [262, 552],
      [204, 552],
    ],
    rgb("#C96A3E"),
  );
  cv.line(96, 540, 170, 540, 2, rgb("#D8CBB0"), 0.6);
  cv.line(196, 534, 268, 534, 2, rgb("#9A4E2C"), 0.6);

  // ---- framed pictures on right wall ----
  cv.rrect(700, 96, 800, 196, 4, C.wood);
  cv.rect(708, 104, 792, 188, rgb("#B7C4A8"));
  cv.circle(750, 146, 26, rgb("#E9A86C"));
  cv.poly(
    [
      [708, 188],
      [740, 150],
      [768, 172],
      [792, 148],
      [792, 188],
    ],
    rgb("#5C6E58"),
  );
  cv.rrect(818, 130, 896, 208, 4, C.wood);
  cv.rect(826, 138, 888, 200, rgb("#D9C9A8"));
  cv.circle(857, 168, 18, rgb("#8A5A33"));
  cv.line(840, 186, 874, 186, 3, rgb("#8A5A33"), 0.8);

  // ---- floor lamp (right) ----
  cv.line(892, 640, 892, 330, 8, rgb("#4A3524"));
  cv.circle(892, 640, 22, rgb("#4A3524"));
  cv.poly(
    [
      [848, 330],
      [936, 330],
      [916, 236],
      [868, 236],
    ],
    C.lampShade,
  );
  cv.glow(892, 290, 220, C.lampGlow, 0.55);
  cv.ellipse(892, 330, 44, 8, rgb("#FFE9B8"), 0.9);
  // lamp light pool on wall
  cv.glow(892, 180, 180, C.lampGlow, 0.25);

  // ---- bookshelf edge (far right) ----
  cv.rect(952, 180, W, 640, rgb("#6E4527"));
  cv.rect(952, 180, W, 190, rgb("#7A4E2A"));
  for (let s = 0; s < 3; s++) {
    const y = 300 + s * 110;
    cv.rect(952, y, W, y + 8, rgb("#7A4E2A"));
    for (let b = 0; b < 5; b++) {
      const bx = 962 + b * 13;
      const bh = 34 + ((b * 17) % 22);
      cv.rect(bx, y - bh, bx + 9, y, rgb(["#A4442F", "#3F5A52", "#D9A441", "#5C6E58", "#8A5A33"][b]));
    }
  }

  // ---- wall clock, centre of the empty wall ----
  cv.circle(512, 210, 46, rgb("#F7F2E6"));
  cv.circle(512, 210, 42, rgb("#3E2A1A"));
  cv.circle(512, 210, 38, rgb("#F7F2E6"));
  cv.line(512, 210, 512, 178, 4, rgb("#3E2A1A"));
  cv.line(512, 210, 536, 222, 4, rgb("#3E2A1A"));
  cv.circle(512, 210, 4, rgb("#A4442F"));
}

// ---- people helpers ----
function head(cv: Canvas, cx: number, cy: number, r: number, skin: RGB, hair: RGB, style: number): void {
  // neck
  cv.rect(cx - 12, cy + r * 0.7, cx + 12, cy + r + 26, skin);
  cv.ellipse(cx, cy, r, r * 1.08, skin);
  // cheeks
  cv.ellipse(cx - r * 0.55, cy + r * 0.28, r * 0.22, r * 0.14, rgb("#E8906A"), 0.45);
  cv.ellipse(cx + r * 0.55, cy + r * 0.28, r * 0.22, r * 0.14, rgb("#E8906A"), 0.45);
  // closed happy eyes (curves) — thick and dark so they survive the soft pass
  cv.line(cx - r * 0.52, cy - r * 0.12, cx - r * 0.2, cy - r * 0.04, 5, C.black, 0.95);
  cv.line(cx + r * 0.2, cy - r * 0.04, cx + r * 0.52, cy - r * 0.12, 5, C.black, 0.95);
  // smile
  cv.line(cx - r * 0.3, cy + r * 0.34, cx - r * 0.1, cy + r * 0.44, 5, rgb("#8A4A30"), 0.95);
  cv.line(cx + r * 0.1, cy + r * 0.44, cx + r * 0.3, cy + r * 0.34, 5, rgb("#8A4A30"), 0.95);
  if (style === 0) {
    // dad: short hair cap
    cv.ellipse(cx, cy - r * 0.55, r * 1.02, r * 0.62, hair);
    cv.rect(cx - r, cy - r * 0.7, cx + r, cy - r * 0.25, hair);
  } else if (style === 1) {
    // mum: shoulder-length hair, side part
    cv.ellipse(cx, cy - r * 0.5, r * 1.08, r * 0.7, hair);
    cv.ellipse(cx - r * 0.95, cy + r * 0.35, r * 0.42, r * 0.85, hair);
    cv.ellipse(cx + r * 0.95, cy + r * 0.3, r * 0.42, r * 0.8, hair);
  } else {
    // kid: messy tuft
    cv.ellipse(cx, cy - r * 0.55, r * 1.0, r * 0.6, hair);
    cv.circle(cx - r * 0.3, cy - r * 1.05, r * 0.28, hair);
    cv.circle(cx + r * 0.25, cy - r * 1.1, r * 0.22, hair);
  }
}

function drawCouch(cv: Canvas): void {
  // back + arms + base (behind people)
  cv.rrect(88, 520, 936, 780, 26, C.couch);
  cv.rrect(88, 520, 936, 560, 26, C.couchLight);
  // back cushions
  for (let i = 0; i < 3; i++) {
    const x0 = 120 + i * 272;
    cv.rrect(x0, 540, x0 + 252, 690, 18, C.cushion);
    cv.rrect(x0 + 8, 548, x0 + 244, 682, 14, mix(C.cushion, C.couchLight, 0.35));
  }
  // armrests
  cv.rrect(88, 640, 150, 830, 18, C.couchDark);
  cv.rrect(874, 640, 936, 830, 18, C.couchDark);
  cv.rrect(92, 640, 146, 668, 14, C.couchLight);
  cv.rrect(878, 640, 932, 668, 14, C.couchLight);
  // seat cushion band behind the sitters' legs (drawn before people)
  cv.rrect(150, 780, 874, 872, 14, mix(C.cushion, C.couchLight, 0.4));
  for (let i = 1; i < 3; i++) {
    cv.rect(150 + i * 241, 780, 152 + i * 241, 872, rgb("#7E3F22"), 0.4);
  }
  // folded blanket over the left armrest
  cv.rrect(96, 636, 146, 700, 10, rgb("#7A9BA8"));
  cv.line(100, 668, 142, 668, 3, rgb("#E8E0C8"), 0.7);
}

function drawPeople(cv: Canvas): void {
  // ---- DAD (left), leaning back, newspaper open ----
  // torso
  cv.poly(
    [
      [196, 690],
      [330, 690],
      [348, 820],
      [180, 820],
    ],
    C.sweaterDad,
  );
  // arms to newspaper
  cv.line(210, 720, 268, 800, 26, C.sweaterDad);
  cv.line(318, 720, 268, 802, 26, C.sweaterDad);
  // newspaper (open, angled)
  cv.poly(
    [
      [216, 742],
      [322, 742],
      [330, 836],
      [208, 836],
    ],
    C.paper,
  );
  cv.line(268, 744, 268, 834, 2, rgb("#B8AC90"));
  for (let i = 0; i < 4; i++) {
    cv.line(226, 762 + i * 16, 258, 762 + i * 16, 3, rgb("#8A8578"), 0.7);
    cv.line(278, 762 + i * 16, 312, 762 + i * 16, 3, rgb("#8A8578"), 0.7);
  }
  // hands
  cv.circle(224, 748, 11, C.skinDad);
  cv.circle(314, 748, 11, C.skinDad);
  // legs stretched forward (jeans)
  cv.poly(
    [
      [196, 806],
      [300, 806],
      [330, 880],
      [180, 880],
    ],
    rgb("#4A5468"),
  );
  cv.poly(
    [
      [200, 872],
      [330, 872],
      [336, 896],
      [196, 896],
    ],
    rgb("#2A2320"),
  );
  head(cv, 262, 636, 46, C.skinDad, C.hairDad, 0);

  // ---- MUM (centre-left), laughing, arm around kid's side ----
  cv.poly(
    [
      [392, 686],
      [516, 686],
      [536, 820],
      [376, 820],
    ],
    C.cardiganMum,
  );
  // cardigan opening + top
  cv.poly(
    [
      [440, 690],
      [470, 690],
      [478, 800],
      [434, 800],
    ],
    rgb("#F2EAD8"),
  );
  // left arm resting on couch, right arm reaching toward kid
  cv.line(400, 716, 372, 800, 24, C.cardiganMum);
  cv.line(508, 712, 560, 742, 24, C.cardiganMum);
  cv.circle(560, 744, 12, C.skinMum);
  // lap / skirt
  cv.poly(
    [
      [384, 800],
      [528, 800],
      [540, 878],
      [372, 878],
    ],
    rgb("#7A4A3A"),
  );
  head(cv, 454, 630, 44, C.skinMum, C.hairMum, 1);

  // ---- ROBOT (centre-right) — the machine member, seated like family ----
  const rx = 640;
  // body: rounded torso
  cv.rrect(rx - 62, 690, rx + 62, 836, 30, C.robotBody);
  cv.rrect(rx - 62, 690, rx + 62, 716, 30, C.robotTeal);
  // chest panel with soft glow
  cv.rrect(rx - 30, 736, rx + 30, 786, 10, rgb("#2E5E5C"));
  cv.circle(rx - 12, 760, 7, rgb("#FFB347"));
  cv.circle(rx + 12, 760, 7, rgb("#7EC8A8"));
  // apron (mustard, worn over the body)
  cv.poly(
    [
      [rx - 52, 712],
      [rx + 52, 712],
      [rx + 58, 836],
      [rx - 58, 836],
    ],
    C.apron,
  );
  cv.poly(
    [
      [rx - 52, 712],
      [rx - 30, 712],
      [rx - 24, 736],
      [rx - 56, 736],
    ],
    C.apronDark,
  );
  cv.poly(
    [
      [rx + 30, 712],
      [rx + 52, 712],
      [rx + 56, 736],
      [rx + 24, 736],
    ],
    C.apronDark,
  );
  // apron pocket
  cv.rrect(rx - 26, 786, rx + 26, 824, 6, C.apronDark);
  // arms: left resting on couch arm, right holding a mug with both hands
  cv.line(rx - 58, 716, rx - 96, 786, 30, C.robotBody);
  cv.circle(rx - 98, 790, 17, C.robotBody);
  cv.line(rx + 56, 716, rx + 30, 792, 30, C.robotBody);
  cv.line(rx - 56, 716, rx - 28, 792, 30, C.robotBody);
  // folded tea towel on the lap
  cv.rrect(rx - 44, 812, rx + 10, 836, 6, rgb("#F7F2E6"));
  cv.line(rx - 44, 824, rx + 10, 824, 2, rgb("#3E7C7A"), 0.7);
  // mug held in both hands, steam
  cv.rrect(rx - 16, 770, rx + 22, 802, 6, rgb("#F2EAD8"));
  cv.ellipse(rx + 24, 786, 8, 10, rgb("#F2EAD8"));
  cv.ellipse(rx + 3, 772, 14, 4, rgb("#8A5A33"));
  cv.line(rx - 2, 764, rx - 6, 748, 3, rgb("#FFFFFF"), 0.55);
  cv.line(rx + 8, 764, rx + 12, 746, 3, rgb("#FFFFFF"), 0.55);
  cv.circle(rx - 30, 792, 12, C.robotBody);
  cv.circle(rx + 32, 792, 12, C.robotBody);
  // legs / base seated
  cv.poly(
    [
      [rx - 58, 830],
      [rx + 58, 830],
      [rx + 66, 884],
      [rx - 66, 884],
    ],
    C.robotDark,
  );
  // head: round, warm screen-face
  cv.ellipse(rx, 622, 52, 56, C.robotBody);
  cv.ellipse(rx, 622, 52, 56, rgb("#FFFFFF"), 0.12);
  // face screen
  cv.ellipse(rx, 626, 40, 42, rgb("#2E3A3A"));
  // two warm glowing eyes + small smile
  cv.glow(rx - 16, 618, 16, rgb("#FFB347"), 0.8);
  cv.glow(rx + 16, 618, 16, rgb("#FFB347"), 0.8);
  cv.circle(rx - 16, 618, 7, rgb("#FFC46B"));
  cv.circle(rx + 16, 618, 7, rgb("#FFC46B"));
  cv.line(rx - 10, 640, rx + 10, 640, 3, rgb("#FFC46B"), 0.9);
  // head seam + ear caps
  cv.line(rx - 50, 600, rx + 50, 600, 2, C.robotDark, 0.5);
  cv.circle(rx - 52, 622, 8, C.robotTeal);
  cv.circle(rx + 52, 622, 8, C.robotTeal);

  // ---- KID (right), leaning on the robot, picture book ----
  cv.poly(
    [
      [742, 700],
      [838, 700],
      [852, 820],
      [730, 820],
    ],
    C.shirtKid,
  );
  for (let i = 0; i < 3; i++) {
    cv.line(744, 724 + i * 26, 850, 724 + i * 26, 8, C.stripeKid, 0.8);
  }
  // arms holding a picture book, tilted toward the robot
  cv.line(752, 730, 706, 786, 20, C.shirtKid);
  cv.line(830, 730, 716, 792, 20, C.shirtKid);
  cv.poly(
    [
      [668, 756],
      [730, 742],
      [742, 800],
      [682, 812],
    ],
    rgb("#D9A441"),
  );
  cv.line(700, 750, 706, 804, 2, rgb("#8A5A33"), 0.7);
  cv.circle(668, 760, 9, C.skinKid);
  cv.circle(724, 796, 9, C.skinKid);
  // legs tucked, socks
  cv.poly(
    [
      [736, 806],
      [846, 806],
      [856, 878],
      [726, 878],
    ],
    rgb("#5C6E58"),
  );
  cv.poly(
    [
      [730, 870],
      [856, 870],
      [860, 892],
      [726, 892],
    ],
    rgb("#F2EAD8"),
  );
  head(cv, 790, 648, 40, C.skinKid, C.hairKid, 2);

  // couch front rail over the laps' bottom edge — low, so legs stay visible
  cv.rrect(88, 900, 936, 946, 16, C.couchDark);
  cv.rrect(88, 900, 936, 916, 16, C.couchLight);
  // cushion seams on the rail
  for (let i = 1; i < 3; i++) {
    cv.rect(88 + i * 282, 900, 90 + i * 282, 946, rgb("#7E3F22"), 0.6);
  }
  // soft shadows under the couch
  cv.ellipse(512, 956, 430, 20, rgb("#000000"), 0.18);

  // ---- DOG asleep on the rug at the robot's feet (right of the table) ----
  cv.ellipse(856, 968, 58, 24, C.dogFur);
  cv.ellipse(806, 962, 24, 18, C.dogFur);
  cv.ellipse(908, 962, 18, 14, C.dogFur);
  cv.line(800, 968, 788, 978, 5, rgb("#8A5A33"), 0.9);
  cv.ellipse(856, 978, 56, 9, rgb("#8A5A33"), 0.5);
  // dog bowl beside the dog
  cv.ellipse(946, 990, 26, 8, rgb("#3E7C7A"));
  cv.ellipse(946, 985, 20, 6, rgb("#2E5E5C"));
}

function drawCoffeeTable(cv: Canvas): void {
  // foreground coffee table, bottom centre
  cv.poly(
    [
      [300, 906],
      [740, 906],
      [770, 990],
      [270, 990],
    ],
    C.wood,
  );
  cv.poly(
    [
      [300, 906],
      [740, 906],
      [748, 922],
      [292, 922],
    ],
    C.woodLight,
  );
  cv.line(320, 990, 310, 1024, 10, rgb("#5E3A20"));
  cv.line(720, 990, 730, 1024, 10, rgb("#5E3A20"));
  // chopping board with a half-peeled carrot + peeler (the particular detail)
  cv.rrect(330, 912, 470, 966, 8, rgb("#C9A87A"));
  cv.line(352, 936, 428, 930, 14, C.carrot);
  cv.circle(430, 929, 8, C.carrot);
  // peel strips
  cv.line(360, 946, 344, 958, 4, rgb("#F2A65A"), 0.9);
  cv.line(384, 948, 372, 960, 4, rgb("#F2A65A"), 0.9);
  cv.line(408, 946, 398, 958, 4, rgb("#F2A65A"), 0.9);
  // peeler
  cv.line(440, 918, 462, 946, 5, rgb("#B8B0A0"));
  cv.rrect(458, 942, 470, 962, 3, rgb("#3E7C7A"));
  // two mugs
  cv.rrect(500, 912, 540, 952, 6, rgb("#3E7C7A"));
  cv.ellipse(542, 932, 7, 9, rgb("#3E7C7A"));
  cv.ellipse(520, 914, 16, 4, rgb("#8A5A33"));
  cv.rrect(560, 916, 596, 952, 6, rgb("#A4442F"));
  cv.ellipse(598, 934, 7, 9, rgb("#A4442F"));
  // popcorn bowl
  cv.ellipse(660, 946, 42, 14, rgb("#F2EAD8"));
  cv.ellipse(660, 938, 42, 12, rgb("#E8DCC0"));
  for (let i = 0; i < 9; i++) {
    const px = 628 + ((i * 37) % 64);
    const py = 922 + ((i * 23) % 14);
    cv.circle(px, py, 5, rgb("#F7F2E6"));
  }
  // folded newspaper on the table corner
  cv.poly(
    [
      [690, 962],
      [748, 956],
      [752, 976],
      [694, 982],
    ],
    C.paper,
  );
  cv.line(700, 966, 742, 962, 2, rgb("#8A8578"), 0.7);

  // ---- laundry basket on the floor, in front of the couch's left end ----
  cv.poly(
    [
      [104, 920],
      [196, 920],
      [186, 1000],
      [114, 1000],
    ],
    rgb("#B98A4E"),
  );
  for (let i = 0; i < 4; i++) {
    cv.line(110 + i * 22, 926, 108 + i * 22, 996, 3, rgb("#8A5A33"), 0.6);
  }
  cv.ellipse(130, 916, 26, 12, rgb("#F7F2E6"));
  cv.ellipse(168, 914, 24, 12, rgb("#7A9BA8"));
  cv.ellipse(150, 908, 22, 10, rgb("#C96A3E"));
}

function render(): Canvas {
  const cv = new Canvas();
  drawRoom(cv);
  drawCouch(cv);
  drawPeople(cv);
  drawCoffeeTable(cv);
  // evening light: warm lamp glow over the right, cool window light left
  cv.glow(892, 290, 260, C.lampGlow, 0.18);
  cv.glow(180, 240, 300, rgb("#8AA0BE"), 0.07);
  // photographic softness, then grain + grade
  cv.blur(1, 1);
  const rng = mulberry32(20261121);
  cv.grain(rng, 2);
  cv.grade();
  return cv;
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR;
  if (!outDir) {
    console.error("MAKEFUN_OUTPUT_DIR is not set");
    process.exit(1);
  }
  const cv = render();
  const png = encodePNG(cv.toBytes());
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  console.log(`wrote entry.png ${png.length} bytes`);
}

main();

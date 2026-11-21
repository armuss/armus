// A small PNG reader in plain JS, for the one thing the image manipulator
// can't do: tell which pixels of a picked photo are see-through. Its JPEG
// output drops transparency to black, so a background-removed portrait (a
// transparent PNG) came out on black and failed the white-background
// check. The photo is saved as a PNG by the manipulator itself (8 or 16
// bits, not interlaced), read here and flattened onto white, as the
// website's canvas does (apply-teacher.html normalizePhoto).
// Returns null for anything it doesn't read (the caller falls back).

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

type Huffman = { counts: Uint16Array; symbols: Uint16Array };

function huffman(lengths: Uint8Array, n: number): Huffman {
  const counts = new Uint16Array(16);
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1, sum = 0; i < 16; i++) {
    offs[i] = sum;
    sum += counts[i];
  }
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
  return { counts, symbols };
}

/** zlib (RFC 1950) inflate; `sizeHint` is the expected output size */
export function inflate(src: Uint8Array, sizeHint = 0): Uint8Array {
  if (src.length < 2 || (src[0] & 0x0f) !== 8 || (src[1] & 0x20)) throw new Error('zlib');
  let pos = 2;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, sizeHint));
  let outPos = 0;

  const bits = (n: number) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('deflate: out of data');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h: Huffman) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code < first + count) return h.symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('deflate: bad code');
  };
  const room = (n: number) => {
    if (outPos + n <= out.length) return;
    const grown = new Uint8Array(Math.max(out.length * 2, outPos + n));
    grown.set(out);
    out = grown;
  };

  let fixedLit: Huffman | null = null;
  let fixedDist: Huffman | null = null;
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      // stored: drop to a byte boundary, give back whole buffered bytes
      bitBuf = 0;
      pos -= bitCnt >> 3;
      bitCnt = 0;
      if (pos + 4 > src.length) throw new Error('deflate: out of data');
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      if (pos + len > src.length) throw new Error('deflate: out of data');
      room(len);
      out.set(src.subarray(pos, pos + len), outPos);
      outPos += len;
      pos += len;
      continue;
    }
    let lit: Huffman;
    let dist: Huffman;
    if (type === 1) {
      if (!fixedLit || !fixedDist) {
        const l = new Uint8Array(288);
        for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
        fixedLit = huffman(l, 288);
        fixedDist = huffman(new Uint8Array(30).fill(5), 30);
      }
      lit = fixedLit;
      dist = fixedDist;
    } else if (type === 2) {
      const nLit = bits(5) + 257;
      const nDist = bits(5) + 1;
      const nCl = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < nCl; i++) cl[CL_ORDER[i]] = bits(3);
      const clH = huffman(cl, 19);
      const lengths = new Uint8Array(nLit + nDist);
      for (let i = 0; i < nLit + nDist; ) {
        const sym = decode(clH);
        if (sym < 16) lengths[i++] = sym;
        else {
          const prev = sym === 16 ? (i ? lengths[i - 1] : -1) : 0;
          if (prev < 0) throw new Error('deflate: bad repeat');
          let rep = sym === 16 ? 3 + bits(2) : sym === 17 ? 3 + bits(3) : 11 + bits(7);
          if (i + rep > lengths.length) throw new Error('deflate: bad repeat');
          while (rep--) lengths[i++] = prev;
        }
      }
      lit = huffman(lengths.subarray(0, nLit), nLit);
      dist = huffman(lengths.subarray(nLit), nDist);
    } else {
      throw new Error('deflate: bad block');
    }
    for (;;) {
      let sym = decode(lit);
      if (sym < 256) {
        room(1);
        out[outPos++] = sym;
        continue;
      }
      if (sym === 256) break;
      sym -= 257;
      if (sym >= 29) throw new Error('deflate: bad length');
      const len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
      const dSym = decode(dist);
      if (dSym >= 30) throw new Error('deflate: bad distance');
      const d = DIST_BASE[dSym] + bits(DIST_EXTRA[dSym]);
      if (d > outPos) throw new Error('deflate: distance too far');
      room(len);
      for (let i = 0; i < len; i++, outPos++) out[outPos] = out[outPos - d];
    }
  }
  return out.subarray(0, outPos);
}

export type Pixels = { width: number; height: number; data: Uint8Array };

/** RGBA 8-bit pixels of a PNG, or null if it isn't one this reads */
export function decodePng(bytes: Uint8Array): Pixels | null {
  try {
    const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 8 || SIG.some((b, i) => bytes[i] !== b)) return null;
    const u32 = (p: number) => ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    let width = 0;
    let height = 0;
    let depth = 0;
    let colorType = 0;
    let palette: Uint8Array | null = null;
    let trns: Uint8Array | null = null;
    const idat: Uint8Array[] = [];
    let idatLen = 0;
    for (let p = 8; p + 8 <= bytes.length; ) {
      const len = u32(p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      const data = bytes.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') {
        width = u32(p + 8);
        height = u32(p + 12);
        depth = data[8];
        colorType = data[9];
        if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null; // interlaced or unknown
      } else if (type === 'PLTE') palette = data;
      else if (type === 'tRNS') trns = data;
      else if (type === 'IDAT') {
        idat.push(data);
        idatLen += data.length;
      } else if (type === 'IEND') break;
      p += 12 + len;
    }
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
    if (!width || !height || !channels || ![1, 2, 4, 8, 16].includes(depth)) return null;
    if (depth < 8 && colorType !== 0 && colorType !== 3) return null;
    if (colorType === 3 && (!palette || depth === 16)) return null;

    const joined = new Uint8Array(idatLen);
    let o = 0;
    for (const part of idat) {
      joined.set(part, o);
      o += part.length;
    }
    const bpp = Math.max(1, (channels * depth) >> 3);
    const rowBytes = Math.ceil((width * channels * depth) / 8);
    const raw = inflate(joined, height * (rowBytes + 1));
    if (raw.length < height * (rowBytes + 1)) return null;

    // undo the row filters in place
    const rows = new Uint8Array(height * rowBytes);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (rowBytes + 1)];
      const src = y * (rowBytes + 1) + 1;
      const at = y * rowBytes;
      for (let x = 0; x < rowBytes; x++) {
        const a = x >= bpp ? rows[at + x - bpp] : 0;
        const b = y ? rows[at - rowBytes + x] : 0;
        const c = y && x >= bpp ? rows[at - rowBytes + x - bpp] : 0;
        let v = raw[src + x];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) {
          const pp = a + b - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - b);
          const pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        } else if (filter !== 0) return null;
        rows[at + x] = v & 255;
      }
    }

    // one sample (0..255) of pixel x's channel ch on row y
    const maxSub = (1 << depth) - 1;
    const sample = (y: number, x: number, ch: number) => {
      const at = y * rowBytes;
      if (depth === 8) return rows[at + x * channels + ch];
      if (depth === 16) return rows[at + (x * channels + ch) * 2];
      const bit = x * depth;
      const v = (rows[at + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxSub;
      return colorType === 3 ? v : Math.round((v * 255) / maxSub);
    };
    const raw16 = (y: number, x: number, ch: number) =>
      depth === 16 ? (rows[y * rowBytes + (x * channels + ch) * 2] << 8) | rows[y * rowBytes + (x * channels + ch) * 2 + 1] : -1;
    // a tRNS colour key (grey / RGB) in the image's own bit depth
    const key = trns && (colorType === 0 || colorType === 2) ? Array.from({ length: colorType === 0 ? 1 : 3 }, (_, i) => (trns![i * 2] << 8) | trns![i * 2 + 1]) : null;
    const rawSample = (y: number, x: number, ch: number) => {
      if (depth === 16) return raw16(y, x, ch);
      if (depth === 8) return rows[y * rowBytes + x * channels + ch];
      const bit = x * depth;
      return (rows[y * rowBytes + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxSub;
    };

    const data = new Uint8Array(width * height * 4);
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i += 4) {
        let r: number, g: number, b: number;
        let a = 255;
        if (colorType === 3) {
          const idx = sample(y, x, 0);
          r = palette![idx * 3];
          g = palette![idx * 3 + 1];
          b = palette![idx * 3 + 2];
          if (trns && idx < trns.length) a = trns[idx];
        } else if (colorType === 0 || colorType === 4) {
          r = g = b = sample(y, x, 0);
          if (colorType === 4) a = sample(y, x, 1);
          else if (key && rawSample(y, x, 0) === key[0]) a = 0;
        } else {
          r = sample(y, x, 0);
          g = sample(y, x, 1);
          b = sample(y, x, 2);
          if (colorType === 6) a = sample(y, x, 3);
          else if (key && rawSample(y, x, 0) === key[0] && rawSample(y, x, 1) === key[1] && rawSample(y, x, 2) === key[2]) a = 0;
        }
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a;
      }
    }
    return { width, height, data };
  } catch {
    return null;
  }
}

/** Paints see-through pixels onto white, in place; true if there were any. */
export function flattenOnWhite(pixels: Pixels): boolean {
  const d = pixels.data;
  let any = false;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    any = true;
    const w = 255 * (255 - a);
    d[i] = Math.round((d[i] * a + w) / 255);
    d[i + 1] = Math.round((d[i + 1] * a + w) / 255);
    d[i + 2] = Math.round((d[i + 2] * a + w) / 255);
    d[i + 3] = 255;
  }
  return any;
}

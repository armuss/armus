import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode, encode } from 'jpeg-js';
import { tr } from './i18n';
import { decodePng, flattenOnWhite, type Pixels } from './png';

// The website's photo rules (apply-teacher.html / settings.html), the same
// numbers here so the app accepts and rejects exactly what the site does:
//
//   - a teacher's photo must be taken in front of a plain white background
//     (the student-facing marketplace shows every teacher on white). The
//     check is the site's own heuristic, not real background removal: a
//     band around the four edges (8% of the shorter side - the person
//     stands in the middle) has to be at least 60% near-white pixels
//     (each channel >= 200, channels within 45 of each other, so warm
//     indoor light and light-grey backdrops still pass; a coloured,
//     patterned or dark room doesn't).
//   - the photo is re-encoded to a JPEG at most 1024px on its longer side,
//     quality 0.85, before upload.
//   - a student's photo (no background rule) may be at most 5MB.
export const PHOTO_WHITE_BG_MARGIN_RATIO = 0.08;
export const PHOTO_WHITE_BG_MIN_RATIO = 0.6;
export const PHOTO_MAX_DIMENSION = 1024;
export const PHOTO_JPEG_QUALITY = 0.85;
export const STUDENT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export const PHOTO_NEEDS_WHITE_BG =
  'Fotoğrafın arka planı düz beyaz olmalı. Lütfen beyaz bir arka plan önünde çekilmiş bir fotoğraf yükle.';

function isWhiteish(r: number, g: number, b: number) {
  return r >= 200 && g >= 200 && b >= 200 && Math.max(r, g, b) - Math.min(r, g, b) <= 45;
}

// base64 -> bytes without relying on a global atob / Buffer
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length && o < out.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length && o < out.length) out[o++] = n & 255;
  }
  return out;
}

// bytes -> base64 without relying on a global btoa / Buffer
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

// The manipulator's PNG of an image, read into RGBA pixels (null if unreadable)
async function pngPixels(image: { saveAsync: (o: { format: SaveFormat; base64: boolean }) => Promise<{ base64?: string }> }): Promise<Pixels | null> {
  try {
    const png = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
    return png.base64 ? decodePng(base64ToBytes(png.base64)) : null;
  } catch {
    return null;
  }
}

// jpeg-js's encoder hands its bytes back through Node's Buffer, which React
// Native doesn't have: lend it a minimal one for this synchronous call
function encodeJpeg(pixels: Pixels, quality: number): Uint8Array {
  const scope = globalThis as any;
  const lent = typeof scope.Buffer === 'undefined';
  if (lent) scope.Buffer = { from: (a: ArrayLike<number>) => Uint8Array.from(a) };
  try {
    return new Uint8Array(encode(pixels, quality).data as unknown as ArrayLike<number>);
  } finally {
    if (lent) delete scope.Buffer;
  }
}

/** The share of the edge band that is near-white, 0..1 (the site's measure). */
function whiteEdgeRatio(data: Uint8Array, width: number, height: number) {
  const margin = Math.max(1, Math.round(Math.min(width, height) * PHOTO_WHITE_BG_MARGIN_RATIO));
  let white = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!(x < margin || x >= width - margin || y < margin || y >= height - margin)) continue;
      const i = (y * width + x) * 4;
      total++;
      if (isWhiteish(data[i], data[i + 1], data[i + 2])) white++;
    }
  }
  return total ? white / total : 0;
}

/**
 * Prepares a picked photo the way the website does: a JPEG of at most
 * 1024px, and (for a teacher) whether its background passes the white
 * check. The check runs on a 256px copy - the same edge-band ratio, far
 * less to decode on a phone.
 *
 * See-through pixels go onto white first, like the website's canvas: the
 * manipulator's own JPEG turns them black, so a transparent PNG (a
 * portrait with its background removed) uploaded on black and failed the
 * white-background check. The 256px copy is read as a PNG to find them;
 * only a photo that has them is flattened and encoded here, in JS.
 */
export async function preparePhoto(
  uri: string,
  checkWhiteBackground: boolean
): Promise<{ uri: string; base64: string; isWhiteBackground: boolean }> {
  const full = await ImageManipulator.manipulate(uri).renderAsync();
  const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(full.width, full.height));
  const sized =
    scale < 1
      ? await ImageManipulator.manipulate(uri)
          .resize({ width: Math.round(full.width * scale), height: Math.round(full.height * scale) })
          .renderAsync()
      : full;

  const small = Math.min(1, 256 / Math.max(full.width, full.height));
  const probe = await ImageManipulator.manipulate(uri)
    .resize({ width: Math.max(1, Math.round(full.width * small)), height: Math.max(1, Math.round(full.height * small)) })
    .renderAsync();
  let probePixels = await pngPixels(probe);
  const seeThrough = !!probePixels && flattenOnWhite(probePixels);

  let result: { uri: string; base64: string };
  if (seeThrough) {
    const pixels = await pngPixels(sized);
    // never upload it on black
    if (!pixels) throw new Error(tr("Fotoğraf okunamadı."));
    flattenOnWhite(pixels);
    const base64 = bytesToBase64(encodeJpeg(pixels, Math.round(PHOTO_JPEG_QUALITY * 100)));
    result = { uri: `data:image/jpeg;base64,${base64}`, base64 };
  } else {
    // the bytes come back with it: they're what gets uploaded (a JPEG the
    // storage bucket accepts, whatever format the phone picked)
    const saved = await sized.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_JPEG_QUALITY, base64: true });
    if (!saved.base64) throw new Error(tr("Fotoğraf okunamadı."));
    result = { uri: saved.uri, base64: saved.base64 };
  }

  if (!checkWhiteBackground) return { ...result, isWhiteBackground: true };

  if (!probePixels) {
    // the PNG copy couldn't be read: check a JPEG copy, as before
    const probeSaved = await probe.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
    if (!probeSaved.base64) throw new Error(tr("Fotoğraf okunamadı."));
    probePixels = decode(base64ToBytes(probeSaved.base64), { useTArray: true, formatAsRGBA: true });
  }
  return {
    ...result,
    isWhiteBackground: whiteEdgeRatio(probePixels.data, probePixels.width, probePixels.height) >= PHOTO_WHITE_BG_MIN_RATIO,
  };
}

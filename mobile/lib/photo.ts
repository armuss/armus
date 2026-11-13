import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'jpeg-js';

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
function base64ToBytes(b64: string): Uint8Array {
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
 */
export async function preparePhoto(uri: string, checkWhiteBackground: boolean): Promise<{ uri: string; isWhiteBackground: boolean }> {
  const full = await ImageManipulator.manipulate(uri).renderAsync();
  const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(full.width, full.height));
  const sized =
    scale < 1
      ? await ImageManipulator.manipulate(uri)
          .resize({ width: Math.round(full.width * scale), height: Math.round(full.height * scale) })
          .renderAsync()
      : full;
  const saved = await sized.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_JPEG_QUALITY });

  if (!checkWhiteBackground) return { uri: saved.uri, isWhiteBackground: true };

  const small = Math.min(1, 256 / Math.max(full.width, full.height));
  const probe = await ImageManipulator.manipulate(uri)
    .resize({ width: Math.max(1, Math.round(full.width * small)), height: Math.max(1, Math.round(full.height * small)) })
    .renderAsync();
  const probeSaved = await probe.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
  if (!probeSaved.base64) throw new Error('Fotoğraf okunamadı.');
  const pixels = decode(base64ToBytes(probeSaved.base64), { useTArray: true, formatAsRGBA: true });
  return { uri: saved.uri, isWhiteBackground: whiteEdgeRatio(pixels.data, pixels.width, pixels.height) >= PHOTO_WHITE_BG_MIN_RATIO };
}

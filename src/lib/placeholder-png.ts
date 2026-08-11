import { deflateSync } from 'node:zlib';

/**
 * Minimal, dependency-free solid-colour PNG encoder.
 *
 * Used only for DRY_RUN creative generation so the downstream carousel/PDF
 * pipeline can run end-to-end on real image files with the exact requested
 * dimensions, without calling OpenAI.
 */

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

export interface PlaceholderPngOptions {
  width: number;
  height: number;
  /** RGB, each 0-255. Defaults to a neutral slate. */
  rgb?: [number, number, number];
  /**
   * Optional short label (digits, letters, `-`, `.`) stamped in large block
   * glyphs so a rendered dry-run carousel can be checked for slide ORDER by
   * eye, not just page count. Purely a rehearsal aid.
   */
  label?: string;
}

/** 5x7 bitmap glyphs, one string per row, `#` = ink. */
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
};

/** Deterministic, readable background colour derived from a seed string. */
export function placeholderColour(seed: string): [number, number, number] {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  // Spread hues around the wheel at fixed saturation/lightness so every slide
  // is clearly distinct but the deck still looks like one set.
  const hue = hash % 360;
  const c = 0.42;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 0.28;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

export function createPlaceholderPng({
  width,
  height,
  rgb = [71, 85, 105],
  label
}: PlaceholderPngOptions): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid placeholder dimensions: ${width}x${height}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = 1 + width * 3; // filter byte + RGB row
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = rgb[2];
    }
  }

  if (label) {
    const chars = [...label.toUpperCase()].filter((c) => c in GLYPHS);
    if (chars.length > 0) {
      const glyphW = 5;
      const glyphH = 7;
      const gap = 1;
      const totalCells = chars.length * glyphW + (chars.length - 1) * gap;
      // Scale to ~45% of the available box, at least 1px per cell.
      const scale = Math.max(1, Math.floor(Math.min(width / totalCells, height / glyphH) * 0.45));
      const inkW = totalCells * scale;
      const inkH = glyphH * scale;
      const originX = Math.floor((width - inkW) / 2);
      const originY = Math.floor((height - inkH) / 2);
      // Ink contrasts with the background rather than being a fixed colour.
      const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      const ink = luminance > 140 ? 25 : 240;

      chars.forEach((char, index) => {
        const rows = GLYPHS[char]!;
        const charX = originX + index * (glyphW + gap) * scale;
        for (let gy = 0; gy < glyphH; gy++) {
          for (let gx = 0; gx < glyphW; gx++) {
            if (rows[gy]![gx] !== '1') continue;
            for (let dy = 0; dy < scale; dy++) {
              const y = originY + gy * scale + dy;
              if (y < 0 || y >= height) continue;
              const rowStart = y * stride;
              for (let dx = 0; dx < scale; dx++) {
                const x = charX + gx * scale + dx;
                if (x < 0 || x >= width) continue;
                const p = rowStart + 1 + x * 3;
                raw[p] = ink;
                raw[p + 1] = ink;
                raw[p + 2] = ink;
              }
            }
          }
        }
      });
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

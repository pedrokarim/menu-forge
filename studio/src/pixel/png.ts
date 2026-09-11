import type { Bitmap } from './raster';

/**
 * PNG sans perte pour l’éditeur de pixels. Un canvas 2D stocke ses pixels
 * prémultipliés par l’alpha : y passer altère les couleurs des pixels
 * translucides à chaque aller-retour. Ce module lit et écrit donc les PNG
 * lui-même (zlib par `CompressionStream` / `DecompressionStream`).
 *
 * Écriture : RGBA 8 bits, filtre adaptatif par ligne. Lecture : 8 bits non
 * entrelacé (gris, gris + alpha, RGB, RGBA, palette avec `tRNS`) ; tout autre
 * PNG renvoie `null` (le décodage du navigateur prend alors le relais).
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Encode un tampon RGBA en PNG (RGBA 8 bits), octet pour octet. */
export async function encodePng(bitmap: Bitmap): Promise<Blob> {
  const { width, height, data } = bitmap;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const previous = y > 0 ? row - stride : -1;
    let bestScore = Infinity;
    // Filtre adaptatif : celui dont la somme des écarts est la plus faible se compresse le mieux.
    for (let filter = 0; filter < 5; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const value = data[row + x];
        const left = x >= 4 ? data[row + x - 4] : 0;
        const up = previous >= 0 ? data[previous + x] : 0;
        const upLeft = previous >= 0 && x >= 4 ? data[previous + x - 4] : 0;
        const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
        const byte = (value - predicted) & 0xff;
        candidate[x] = byte;
        score += byte < 128 ? byte : 256 - byte;
      }
      if (score < bestScore) {
        bestScore = score;
        raw[y * (stride + 1)] = filter;
        raw.set(candidate, y * (stride + 1) + 1);
      }
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const idat = await through(raw, new CompressionStream('deflate'));
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', header), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  return new Blob(parts as Uint8Array<ArrayBuffer>[], { type: 'image/png' });
}

/** Décode un PNG 8 bits non entrelacé en tampon RGBA ; `null` pour tout autre PNG. */
export async function decodePng(bytes: Uint8Array): Promise<Bitmap | null> {
  if (bytes.length < 8 || SIGNATURE.some((value, index) => bytes[index] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const [depth, color, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || interlace !== 0) return null;
      colorType = color;
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || width === 0 || height === 0 || (colorType === 3 && !palette)) return null;
  const compressed = new Uint8Array(idat.reduce((total, part) => total + part.length, 0));
  let position = 0;
  for (const part of idat) {
    compressed.set(part, position);
    position += part.length;
  }
  let raw: Uint8Array;
  try {
    raw = await through(compressed, new DecompressionStream('deflate'));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y > 0 ? pixels[row - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[row - stride + x - channels] : 0;
      const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
      pixels[row + x] = (raw[source + x] + predicted) & 0xff;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let cell = 0; cell < width * height; cell++) {
    const target = cell * 4;
    const source = cell * channels;
    if (colorType === 6) data.set(pixels.subarray(source, source + 4), target);
    else if (colorType === 2) {
      data.set(pixels.subarray(source, source + 3), target);
      const opaque =
        !transparency ||
        transparency.length < 6 ||
        pixels[source] !== transparency[1] ||
        pixels[source + 1] !== transparency[3] ||
        pixels[source + 2] !== transparency[5];
      data[target + 3] = opaque ? 255 : 0;
    } else if (colorType === 0 || colorType === 4) {
      const gray = pixels[source];
      data[target] = gray;
      data[target + 1] = gray;
      data[target + 2] = gray;
      data[target + 3] = colorType === 4 ? pixels[source + 1] : transparency && transparency.length >= 2 && gray === transparency[1] ? 0 : 255;
    } else if (palette) {
      const entry = pixels[source];
      data[target] = palette[entry * 3] ?? 0;
      data[target + 1] = palette[entry * 3 + 1] ?? 0;
      data[target + 2] = palette[entry * 3 + 2] ?? 0;
      data[target + 3] = transparency && entry < transparency.length ? transparency[entry] : 255;
    }
  }
  return { width, height, data };
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

import { crc32 } from './crc32';
import { concatBytes, deflate, inflate } from './deflate';
import type { RgbaImage } from './image';

/**
 * Lecture et écriture de PNG sans canvas : les pixels semi-transparents sont
 * lus et écrits exactement (un canvas 2D les prémultiplie et arrondit leurs
 * couleurs), comme le fait la lib avec ImageIO.
 *
 * Lecture : niveaux de gris, RVB, palette (avec `tRNS`), gris + alpha, RVBA ;
 * profondeurs 1 à 16 bits ; pas d’entrelacement (Adam7).
 * Écriture : RVBA 8 bits, filtre 0.
 */

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

/** Canaux par type de couleur PNG. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= SIGNATURE.length && SIGNATURE.every((value, index) => bytes[index] === value);
}

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  if (!isPng(bytes)) throw new Error('Ce fichier n’est pas un PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const data: Uint8Array[] = [];

  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error('PNG tronqué');
    const chunk = bytes.subarray(start, end);
    if (type === 'IHDR') {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === 'PLTE') {
      palette = chunk;
    } else if (type === 'tRNS') {
      transparency = chunk;
    } else if (type === 'IDAT') {
      data.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }

  if (width <= 0 || height <= 0) throw new Error('PNG sans en-tête valide');
  if (interlace !== 0) throw new Error('PNG entrelacé non pris en charge');
  const channels = CHANNELS[colorType];
  if (channels === undefined) throw new Error(`Type de couleur PNG inconnu : ${colorType}`);
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error(`Profondeur PNG inconnue : ${bitDepth}`);
  if (colorType === 3 && !palette) throw new Error('PNG à palette sans palette');

  const bitsPerPixel = channels * bitDepth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const raw = await inflate(concatBytes(data));
  if (raw.length < (rowBytes + 1) * height) throw new Error('Données PNG incomplètes');
  const pixels = unfilter(raw, rowBytes, height, Math.max(1, bitsPerPixel >> 3));
  return toRgba(pixels, { width, height, bitDepth, colorType, channels, rowBytes, palette, transparency });
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

function unfilter(raw: Uint8Array, rowBytes: number, height: number, bpp: number): Uint8Array {
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const source = y * (rowBytes + 1) + 1;
    const target = y * rowBytes;
    const previous = target - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const value = raw[source + x];
      const left = x >= bpp ? out[target + x - bpp] : 0;
      const up = y > 0 ? out[previous + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[previous + x - bpp] : 0;
      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4:
          result = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Filtre PNG inconnu : ${filter}`);
      }
      out[target + x] = result & 0xff;
    }
  }
  return out;
}

interface Layout {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  channels: number;
  rowBytes: number;
  palette: Uint8Array | null;
  transparency: Uint8Array | null;
}

function toRgba(pixels: Uint8Array, layout: Layout): RgbaImage {
  const { width, height, bitDepth, colorType, channels, rowBytes, palette, transparency } = layout;
  const out = new Uint8Array(width * height * 4);
  const maxValue = (1 << bitDepth) - 1;
  /** Échantillon brut (0 à 2^profondeur − 1) du canal `channel` du pixel `x` de la ligne `y`. */
  const sample = (y: number, x: number, channel: number): number => {
    const index = x * channels + channel;
    const row = y * rowBytes;
    if (bitDepth === 8) return pixels[row + index];
    if (bitDepth === 16) return (pixels[row + index * 2] << 8) | pixels[row + index * 2 + 1];
    const bit = index * bitDepth;
    return (pixels[row + (bit >> 3)] >> (8 - bitDepth - (bit & 7))) & maxValue;
  };
  /** Échantillon ramené sur 8 bits (hors palette). */
  const scale = (value: number): number =>
    bitDepth === 8 ? value : bitDepth === 16 ? value >> 8 : Math.round((value * 255) / maxValue);
  const key = (index: number): number =>
    transparency && transparency.length >= index * 2 + 2 ? (transparency[index * 2] << 8) | transparency[index * 2 + 1] : -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      if (colorType === 3 && palette) {
        const index = sample(y, x, 0);
        out[target] = palette[index * 3] ?? 0;
        out[target + 1] = palette[index * 3 + 1] ?? 0;
        out[target + 2] = palette[index * 3 + 2] ?? 0;
        out[target + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const gray = sample(y, x, 0);
        const value = scale(gray);
        out[target] = value;
        out[target + 1] = value;
        out[target + 2] = value;
        out[target + 3] = colorType === 4 ? scale(sample(y, x, 1)) : gray === key(0) ? 0 : 255;
      } else {
        const red = sample(y, x, 0);
        const green = sample(y, x, 1);
        const blue = sample(y, x, 2);
        out[target] = scale(red);
        out[target + 1] = scale(green);
        out[target + 2] = scale(blue);
        out[target + 3] =
          colorType === 6 ? scale(sample(y, x, 3)) : red === key(0) && green === key(1) && blue === key(2) ? 0 : 255;
      }
    }
  }
  return { width, height, data: out };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, data } = image;
  const rowBytes = width * 4;
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // profondeur
  header[9] = 6; // RVBA
  return concatBytes([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

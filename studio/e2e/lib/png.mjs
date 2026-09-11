/**
 * PNG et zip, côté Node, sans dépendance : de quoi fabriquer les images de
 * test et relire, octet pour octet, ce que le studio écrit sur le disque.
 *
 * - `encodePng` : RGBA 8 bits, sans entrelacement (images de démo générées ici).
 * - `decodePng` : niveaux de gris, RGB, palette, avec ou sans alpha, 8 bits,
 *   sans entrelacement (ce que produisent le studio et les navigateurs).
 * - `listZip` / `readZipEntry` : lecture du répertoire central d’une archive.
 */
import { deflateSync, inflateRawSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Image RGBA (`data` : largeur × hauteur × 4 octets) → PNG. */
export function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) {
    raw[row * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + row * width * 4, width * 4).copy(raw, row * (width * 4 + 1) + 1);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(left, up, corner) {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

/** PNG → `{ width, height, data }` en RGBA 8 bits. */
export function decodePng(buffer) {
  const bytes = Buffer.from(buffer);
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('signature PNG absente');
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const compressed = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const name = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (name === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') transparency = data;
    else if (name === 'IDAT') compressed.push(data);
    else if (name === 'IEND') break;
    offset += length + 12;
  }
  if (depth !== 8 || interlace !== 0 || !(type in CHANNELS)) {
    throw new Error(`PNG non pris en charge (profondeur ${depth}, type ${type}, entrelacement ${interlace})`);
  }
  const channels = CHANNELS[type];
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    for (let column = 0; column < stride; column++) {
      const left = column >= channels ? pixels[row * stride + column - channels] : 0;
      const up = row > 0 ? pixels[(row - 1) * stride + column] : 0;
      const corner = row > 0 && column >= channels ? pixels[(row - 1) * stride + column - channels] : 0;
      const value = line[column];
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter];
      if (predicted === undefined) throw new Error(`filtre PNG inconnu : ${filter}`);
      pixels[row * stride + column] = (value + predicted) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const source = pixels.subarray(index * channels, index * channels + channels);
    let rgba;
    if (type === 6) rgba = [source[0], source[1], source[2], source[3]];
    else if (type === 2) rgba = [source[0], source[1], source[2], 255];
    else if (type === 0) rgba = [source[0], source[0], source[0], 255];
    else if (type === 4) rgba = [source[0], source[0], source[0], source[1]];
    else {
      const entry = source[0];
      rgba = [palette[entry * 3], palette[entry * 3 + 1], palette[entry * 3 + 2], transparency?.[entry] ?? 255];
    }
    data.set(rgba, index * 4);
  }
  return { width, height, data };
}

/** Image RGBA transparente, remplie de rectangles `[x, y, largeur, hauteur, [r, g, b, a]]`. */
export function paintImage(width, height, rects) {
  const data = new Uint8Array(width * height * 4);
  for (const [x, y, w, h, color] of rects) {
    for (let row = y; row < y + h; row++) {
      for (let column = x; column < x + w; column++) data.set(color, (row * width + column) * 4);
    }
  }
  return { width, height, data };
}

/** Pixel `[r, g, b, a]` d’une image RGBA. */
export function pixelAt(image, x, y) {
  return [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
}

/** Sous-image (copie) d’une image RGBA. */
export function cropImage(image, x, y, width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    data.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4), row * width * 4);
  }
  return { width, height, data };
}

/** Entrées d’une archive zip : `[{ name, method, compressedSize, offset }]`. */
export function listZip(buffer) {
  const bytes = Buffer.from(buffer);
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('fin de répertoire central introuvable');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('répertoire central illisible');
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    entries.push({ name: bytes.toString('utf8', offset + 46, offset + 46 + nameLength), method, compressedSize, offset: local });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Contenu décompressé d’une entrée de `listZip`. */
export function readZipEntry(buffer, entry) {
  const bytes = Buffer.from(buffer);
  const start = entry.offset + 30 + bytes.readUInt16LE(entry.offset + 26) + bytes.readUInt16LE(entry.offset + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`compression zip inconnue : ${entry.method}`);
}

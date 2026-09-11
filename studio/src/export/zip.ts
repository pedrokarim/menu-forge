import { crc32 } from './crc32';
import { concatBytes, deflateRaw } from './deflate';

/** Fichier d’une archive : chemin avec des `/`, contenu. */
export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

/** Date fixe (1er janvier 1980, format DOS) : deux exports identiques donnent la même archive. */
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;
/** Bit 11 : noms en UTF-8. */
const UTF8_FLAG = 0x0800;

const encoder = new TextEncoder();

/**
 * Archive zip (entrées compressées en deflate, ou stockées si la compression
 * n’y gagne rien), dans l’ordre donné. Lisible par Minecraft comme resource pack.
 */
export async function createZip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const checksum = crc32(entry.data);
    const deflated = await deflateRaw(entry.data);
    const stored = deflated.length >= entry.data.length;
    const body = stored ? entry.data : deflated;
    const method = stored ? 0 : 8;

    const local = new Uint8Array(30 + name.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, UTF8_FLAG, true);
    header.setUint16(8, method, true);
    header.setUint16(10, DOS_TIME, true);
    header.setUint16(12, DOS_DATE, true);
    header.setUint32(14, checksum, true);
    header.setUint32(18, body.length, true);
    header.setUint32(22, entry.data.length, true);
    header.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, body);

    const central = new Uint8Array(46 + name.length);
    const record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, UTF8_FLAG, true);
    record.setUint16(10, method, true);
    record.setUint16(12, DOS_TIME, true);
    record.setUint16(14, DOS_DATE, true);
    record.setUint32(16, checksum, true);
    record.setUint32(20, body.length, true);
    record.setUint32(24, entry.data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);

    offset += local.length + body.length;
  }

  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const trailer = new DataView(end.buffer);
  trailer.setUint32(0, 0x06054b50, true);
  trailer.setUint16(8, entries.length, true);
  trailer.setUint16(10, entries.length, true);
  trailer.setUint32(12, directorySize, true);
  trailer.setUint32(16, offset, true);
  return concatBytes([...parts, ...directory, end]);
}

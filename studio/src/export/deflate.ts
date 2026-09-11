/**
 * Compression par les flux standard du navigateur (et de Node) : `deflate`
 * (format zlib, celui des PNG) et `deflate-raw` (celui des archives zip).
 */

async function run(data: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  // Copie dans un ArrayBuffer ordinaire : les flux de compression n’acceptent
  // pas une vue sur un tampon partagé (SharedArrayBuffer).
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });
  const buffer = await new Response(source.pipeThrough(transform)).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Compresse au format zlib. */
export const deflate = (data: Uint8Array) => run(data, new CompressionStream('deflate'));

/** Décompresse du zlib. */
export const inflate = (data: Uint8Array) => run(data, new DecompressionStream('deflate'));

/** Compresse en deflate brut (entrées d’une archive zip). */
export const deflateRaw = (data: Uint8Array) => run(data, new CompressionStream('deflate-raw'));

/** Concatène des tableaux d’octets. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * JSON écrit exactement comme le Gson de la lib (`JsonText`) : indentation de
 * 2 espaces, pas d’échappement HTML ; U+2028 et U+2029 toujours échappés ; en
 * version indentée (fichiers du pack), caractères de la zone privée
 * (U+E000–U+F8FF) échappés en `\uXXXX` minuscule.
 */

const BACKSLASH = String.fromCharCode(92);

function escape(json: string, privateUse: boolean): string {
  let out = '';
  for (const char of json) {
    const code = char.charCodeAt(0);
    if (code === 0x2028 || code === 0x2029 || (privateUse && code >= 0xe000 && code <= 0xf8ff)) {
      out += `${BACKSLASH}u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += char;
    }
  }
  return out;
}

/** JSON indenté (fichiers du pack). */
export function prettyJson(value: unknown): string {
  return escape(JSON.stringify(value, null, 2), true);
}

/** JSON compact (composants de titre) ; la zone privée n’est pas échappée. */
export function compactJson(value: unknown): string {
  return escape(JSON.stringify(value), false);
}

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

// Police des textes du titre : mêmes providers et mêmes avances que la lib
// (`AsciiFont`, `CharWidths`, testés par PackGeneratorTest et CharWidthsTest).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asciiFont } from '../src/export/fonts.ts';
import { charAdvance, textWidth } from '../src/model/fontMetrics.ts';

interface Provider {
  type: string;
  file?: string;
  ascent?: number;
  height?: number;
  chars?: string[];
}

const EMPTY = String.fromCharCode(0);

test('la police de texte reprend les trois planches vanilla, accents compris', () => {
  const { providers } = asciiFont(-3) as { providers: Provider[] };
  assert.deepEqual(
    providers.map((provider) => [provider.type, provider.file, provider.ascent, provider.height]),
    [
      ['space', undefined, undefined, undefined],
      ['bitmap', 'minecraft:font/ascii.png', -3, 8],
      ['bitmap', 'minecraft:font/accented.png', 0, 12],
      ['bitmap', 'minecraft:font/nonlatin_european.png', -3, 8],
    ],
  );
  const chars = (provider: Provider) => (provider.chars ?? []).join('');
  assert.ok(!chars(providers[1]).includes('é'), 'plus d’accents dans ascii.png');
  assert.equal(providers[1].chars?.[0], EMPTY.repeat(16));
  assert.ok(chars(providers[2]).includes('é'));
  assert.ok(chars(providers[2]).includes('É'));
  assert.ok(chars(providers[3]).includes('’'));
});

test('avances des accents : celles du jeu', () => {
  // R 6, é 6, c 6, o 6, l 3, t 4, e 6, s 6.
  assert.equal(textWidth('Récoltes'), 43);
  assert.equal(charAdvance('É'), 6);
  assert.equal(charAdvance('î'), 4);
  assert.equal(charAdvance('œ'), 10);
  assert.equal(charAdvance('’'), 3);
  assert.equal(charAdvance('€'), 7);
  assert.equal(textWidth('3/46'), 24);
  assert.equal(charAdvance(' '), 4);
  assert.equal(charAdvance('中'), 6, 'caractère absent : glyphe « manquant »');
});

package dev.menuforge.text;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CharWidthsTest {

  @Test
  void asciiAdvancesAreUnchanged() {
    assertEquals(4, CharWidths.advance(' '));
    assertEquals(2, CharWidths.advance('i'));
    assertEquals(4, CharWidths.advance('I'));
    assertEquals(6, CharWidths.advance('a'));
    assertEquals(24, CharWidths.width("3/46"));
  }

  @Test
  void accentedLettersUseTheVanillaAdvances() {
    // R 6, é 6 (accented.png), c 6, o 6, l 3, t 4, e 6, s 6.
    assertEquals(43, CharWidths.width("Récoltes"));
    assertEquals(6, CharWidths.advance('É'));
    assertEquals(4, CharWidths.advance('î'));
    assertEquals(10, CharWidths.advance('œ'));
    // nonlatin_european.png : apostrophe typographique et euro.
    assertEquals(3, CharWidths.advance('’'));
    assertEquals(7, CharWidths.advance('€'));
  }

  @Test
  void unknownCharactersFallBackToTheMissingGlyph() {
    assertEquals(6, CharWidths.advance(0x4e2d));
  }
}

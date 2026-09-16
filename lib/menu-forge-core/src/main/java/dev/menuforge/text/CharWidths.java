package dev.menuforge.text;

import java.util.HashMap;
import java.util.Map;

/**
 * Avances des caractères des textes du titre, celles de la police vanilla.
 *
 * <p>Source : {@link VanillaFontData}, généré depuis le jar client par
 * {@code studio/scripts/vanilla_font_tables.py} (avance = dernière colonne non
 * transparente de la case + 1, à l’échelle de la planche, + 1 d’espacement,
 * comme le jeu). Couvre {@code ascii.png}, {@code accented.png} et
 * {@code nonlatin_european.png}. L’espace avance de 4 (provider {@code space}).
 * Un caractère absent des trois planches s’affiche en glyphe « manquant »,
 * large de 5 px (avance 6).
 *
 * <p>Le studio lit la même table ({@code studio/src/model/vanillaFontData.ts}) :
 * sinon les textes centrés ou alignés à droite divergent.
 */
public final class CharWidths {

  /** Avance de l’espace. */
  public static final int SPACE_ADVANCE = 4;
  /** Largeur d’un caractère absent de la police (glyphe « manquant »). */
  public static final int DEFAULT_WIDTH = 5;

  /** Avance de chaque point de code des planches. */
  private static final Map<Integer, Integer> ADVANCES = new HashMap<>();

  static {
    for (final VanillaFontData.Sheet sheet : VanillaFontData.SHEETS) {
      for (int row = 0; row < sheet.chars().size(); row++) {
        final int[] chars = sheet.chars().get(row).codePoints().toArray();
        final String advances = sheet.advances().get(row);
        if (chars.length != advances.length()) {
          throw new IllegalStateException(sheet.file() + " : ligne " + row + " incohérente");
        }
        for (int column = 0; column < chars.length; column++) {
          if (chars[column] != 0) {
            ADVANCES.putIfAbsent(chars[column], Character.digit(advances.charAt(column), 36));
          }
        }
      }
    }
  }

  private CharWidths() {
  }

  /** Avance (en pixels GUI) d’un point de code. */
  public static int advance(final int codePoint) {
    if (codePoint == ' ') {
      return SPACE_ADVANCE;
    }
    final Integer advance = ADVANCES.get(codePoint);
    return advance != null ? advance : DEFAULT_WIDTH + 1;
  }

  /** Largeur d’un texte : somme des avances de ses caractères. */
  public static int width(final String text) {
    if (text == null) {
      return 0;
    }
    return text.codePoints().map(CharWidths::advance).sum();
  }
}

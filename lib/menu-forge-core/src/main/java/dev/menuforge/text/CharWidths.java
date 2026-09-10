package dev.menuforge.text;

import java.util.HashMap;
import java.util.Map;

/**
 * Avances des caractères de la police ASCII vanilla ({@code minecraft:font/ascii.png}).
 *
 * <p><b>À vérifier en jeu.</b> Table reprise des largeurs connues de la police
 * vanilla : avance = largeur du dessin + 1, sauf l’espace (avance 4, fournie
 * par un provider {@code space}). Tout caractère absent de la table (y compris
 * hors ASCII : lettres accentuées…) est supposé large de 5 px, soit une avance
 * de 6. Le studio embarque la même table : toute correction doit être reportée
 * des deux côtés, sinon les textes centrés ou alignés à droite divergent.
 */
public final class CharWidths {

  /** Avance de l’espace. */
  public static final int SPACE_ADVANCE = 4;
  /** Largeur par défaut d’un caractère absent de la table. */
  public static final int DEFAULT_WIDTH = 5;

  /** Largeurs (sans l’espacement de 1 px) des caractères qui dérogent à 5. */
  private static final Map<Character, Integer> WIDTHS = new HashMap<>();

  static {
    put('!', 1);
    put('"', 3);
    put('\'', 1);
    put('(', 3);
    put(')', 3);
    put('*', 3);
    put(',', 1);
    put('.', 1);
    put(':', 1);
    put(';', 1);
    put('<', 4);
    put('>', 4);
    put('@', 6);
    put('I', 3);
    put('[', 3);
    put(']', 3);
    put('`', 2);
    put('f', 4);
    put('i', 1);
    put('k', 4);
    put('l', 2);
    put('t', 3);
    put('{', 3);
    put('|', 1);
    put('}', 3);
    put('~', 6);
  }

  private CharWidths() {
  }

  private static void put(final char character, final int width) {
    WIDTHS.put(character, width);
  }

  /** Avance (en pixels GUI) d’un point de code. */
  public static int advance(final int codePoint) {
    if (codePoint == ' ') {
      return SPACE_ADVANCE;
    }
    if (codePoint <= Character.MAX_VALUE) {
      final Integer width = WIDTHS.get((char) codePoint);
      if (width != null) {
        return width + 1;
      }
    }
    return DEFAULT_WIDTH + 1;
  }

  /** Largeur d’un texte : somme des avances de ses caractères. */
  public static int width(final String text) {
    if (text == null) {
      return 0;
    }
    return text.codePoints().map(CharWidths::advance).sum();
  }
}

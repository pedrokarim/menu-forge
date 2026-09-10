package dev.menuforge.render;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Caractères d’espacement du provider {@code space} de chaque police de menu.
 *
 * <p>Un caractère par puissance de 2, de 1 à 1024, dans les deux sens :
 * <ul>
 *   <li>négatifs : {@code U+F801} (−1), {@code U+F802} (−2), {@code U+F803} (−4) … {@code U+F80B} (−1024) ;</li>
 *   <li>positifs : {@code U+F821} (+1), {@code U+F822} (+2) … {@code U+F82B} (+1024).</li>
 * </ul>
 * Un décalage quelconque se compose en somme de puissances (1024 répété au
 * besoin au-delà de 2047).
 */
public final class SpaceFont {

  /** Plus grande puissance de 2 disponible (2^10 = 1024). */
  public static final int MAX_POWER = 10;
  /** Premier caractère négatif (−1). */
  public static final int NEGATIVE_BASE = 0xF801;
  /** Premier caractère positif (+1). */
  public static final int POSITIVE_BASE = 0xF821;

  private SpaceFont() {
  }

  /** Caractère d’avance {@code ±2^power}. */
  public static char character(final int power, final boolean negative) {
    if (power < 0 || power > MAX_POWER) {
      throw new IllegalArgumentException("puissance hors limites : " + power);
    }
    return (char) ((negative ? NEGATIVE_BASE : POSITIVE_BASE) + power);
  }

  /** Suite de caractères dont la somme des avances vaut {@code shift} (vide pour 0). */
  public static String encode(final int shift) {
    if (shift == 0) {
      return "";
    }
    final boolean negative = shift < 0;
    long remaining = Math.abs((long) shift);
    final StringBuilder builder = new StringBuilder();
    final long max = 1L << MAX_POWER;
    while (remaining >= max) {
      builder.append(character(MAX_POWER, negative));
      remaining -= max;
    }
    for (int power = MAX_POWER - 1; power >= 0; power--) {
      if ((remaining & (1L << power)) != 0) {
        builder.append(character(power, negative));
      }
    }
    return builder.toString();
  }

  /** Avance totale d’une chaîne composée de caractères d’espacement (0 pour les autres). */
  public static int advanceOf(final String encoded) {
    int total = 0;
    for (int i = 0; i < encoded.length(); i++) {
      final int c = encoded.charAt(i);
      if (c >= NEGATIVE_BASE && c <= NEGATIVE_BASE + MAX_POWER) {
        total -= 1 << (c - NEGATIVE_BASE);
      } else if (c >= POSITIVE_BASE && c <= POSITIVE_BASE + MAX_POWER) {
        total += 1 << (c - POSITIVE_BASE);
      }
    }
    return total;
  }

  /** Table {@code caractère → avance} du provider {@code space}. */
  public static Map<String, Integer> advances() {
    final Map<String, Integer> advances = new LinkedHashMap<>();
    for (int power = 0; power <= MAX_POWER; power++) {
      advances.put(String.valueOf(character(power, true)), -(1 << power));
    }
    for (int power = 0; power <= MAX_POWER; power++) {
      advances.put(String.valueOf(character(power, false)), 1 << power);
    }
    return advances;
  }
}

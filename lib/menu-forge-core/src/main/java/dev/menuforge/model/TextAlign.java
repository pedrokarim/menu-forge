package dev.menuforge.model;

import java.util.Locale;

/** Alignement horizontal d’un texte par rapport à son abscisse d’ancrage. */
public enum TextAlign {
  LEFT,
  CENTER,
  RIGHT;

  /** Nom tel qu’écrit dans le format ({@code left}, {@code center}, {@code right}). */
  public String key() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** Lit un alignement depuis sa clé JSON, ou {@code null} si inconnu. */
  public static TextAlign fromKey(final String key) {
    for (final TextAlign align : values()) {
      if (align.key().equals(key)) {
        return align;
      }
    }
    return null;
  }
}

package dev.menuforge.model;

import java.util.Locale;

/** Type de slot (voir {@code docs/format.md}, § Slots). */
public enum SlotKind {
  /** Même item et mêmes actions sur toute la zone. */
  BUTTON,
  /** Remplie par une source de données nommée, paginée par la lib. */
  LIST,
  /** Le joueur peut y déposer et y retirer un item. */
  INPUT,
  /** Item affiché, jamais cliquable. */
  DECORATION;

  /** Nom tel qu’écrit dans le format. */
  public String key() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** Lit un type depuis sa clé JSON, ou {@code null} si inconnu. */
  public static SlotKind fromKey(final String key) {
    for (final SlotKind kind : values()) {
      if (kind.key().equals(key)) {
        return kind;
      }
    }
    return null;
  }
}

package dev.menuforge.model;

import java.util.Objects;

/**
 * Instance d’un composant dans un menu (clé {@code includes}, voir
 * {@code docs/format.md}, § Composants) : les couches, textes et slots du menu
 * {@code component}, décalés et préfixés, sont ajoutés sous ceux du menu.
 *
 * @param component   id du menu composant
 * @param prefix      préfixe ajouté aux ids des éléments de l’instance (vide = aucun)
 * @param col         décalage en colonnes (zones de slots ; couches et textes : 18 px par colonne)
 * @param row         décalage en lignes (zones de slots ; couches et textes : 18 px par ligne)
 * @param x           décalage supplémentaire en pixels, couches et textes seulement
 * @param y           décalage supplémentaire en pixels, couches et textes seulement
 * @param visibleWhen condition ajoutée à celle de chaque élément de l’instance, ou {@code null}
 */
public record Include(String component, String prefix, int col, int row, int x, int y, Condition visibleWhen) {

  public Include {
    Objects.requireNonNull(component, "component");
    prefix = prefix == null ? "" : prefix;
  }

  /** Instance sans préfixe ni décalage. */
  public static Include of(final String component) {
    return new Include(component, "", 0, 0, 0, 0, null);
  }
}

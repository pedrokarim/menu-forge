package dev.menuforge.model;

import java.util.List;

/**
 * Description d’un item affiché dans un slot.
 *
 * <p>{@code name} et {@code lore} sont en MiniMessage et acceptent les
 * variables ; le noyau ne les interprète pas (c’est le rôle du runtime).
 *
 * @param invisible {@code true} : item sans rendu (le bouton est dessiné par une couche)
 * @param material  matériau vanilla (ex. {@code PLAYER_HEAD}), ou {@code null}
 * @param head      propriétaire de la tête (ex. {@code {viewer}}), ou {@code null}
 * @param name      nom affiché (MiniMessage), ou {@code null}
 * @param lore      lignes de description (MiniMessage)
 * @param ref       référence déléguée à l’adaptateur du serveur, ou {@code null}
 */
public record ItemSpec(
  boolean invisible,
  String material,
  String head,
  String name,
  List<String> lore,
  String ref
) {

  public ItemSpec {
    lore = List.copyOf(lore == null ? List.of() : lore);
  }
}

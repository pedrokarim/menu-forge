package dev.menuforge.paper.api;

import org.bukkit.entity.Player;

import java.util.Map;

/**
 * Menus ouverts par un joueur : une pile (pour {@code back}), l’état du menu
 * courant et sa pagination. L’état vit par joueur et par ouverture.
 */
public interface MenuSession {

  /** Joueur concerné. */
  Player player();

  /** Id du menu affiché, ou {@code null} si la session est terminée. */
  String menuId();

  /** Valeurs d’état du menu affiché (copie non modifiable). */
  Map<String, Object> state();

  /** Nombre de menus empilés. */
  int depth();

  /**
   * Change une variable d’état puis reconstruit le menu.
   *
   * @throws IllegalArgumentException si l’état est inconnu ou la valeur invalide
   */
  void setState(String name, Object value);

  /** Ouvre un autre menu par-dessus celui-ci. */
  void open(String menuId, Map<String, Object> initialState);

  /** Revient au menu précédent, ou ferme s’il n’y en a pas. */
  void back();

  /** Ferme l’inventaire et termine la session. */
  void close();

  /** Reconstruit le menu affiché (titre, slots, listes). */
  void refresh();
}

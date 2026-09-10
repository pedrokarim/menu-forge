package dev.menuforge.paper.api;

import org.bukkit.entity.Player;

import java.util.Map;

/**
 * Demande d’entrées adressée à un {@link ListProvider}.
 *
 * @param viewer joueur qui regarde le menu
 * @param menuId menu en cours de construction
 * @param list   nom de la liste
 * @param state  valeurs d’état courantes (pour filtrer selon l’onglet, par exemple)
 */
public record ListRequest(Player viewer, String menuId, String list, Map<String, Object> state) {

  public ListRequest {
    state = Map.copyOf(state);
  }
}

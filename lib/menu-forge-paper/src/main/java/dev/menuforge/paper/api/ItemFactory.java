package dev.menuforge.paper.api;

import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/**
 * Fabrique des items que le format ne sait pas décrire seul : les items
 * {@code ref} (délégués au serveur) et l’item « invisible » des boutons.
 * Le nom et la description éventuels du format sont appliqués ensuite.
 */
public interface ItemFactory {

  /** Item désigné par {@code ref}, ou {@code null} si la référence est inconnue. */
  ItemStack create(String ref, Player viewer);

  /** Item sans rendu, posé sur un bouton dessiné par une couche du titre. */
  ItemStack invisible(Player viewer);
}

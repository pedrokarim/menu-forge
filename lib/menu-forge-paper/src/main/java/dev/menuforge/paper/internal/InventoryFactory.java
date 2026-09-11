package dev.menuforge.paper.internal;

import net.kyori.adventure.text.Component;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;

/**
 * Création du coffre d’un menu. Par défaut {@code Bukkit.createInventory} ;
 * remplaçable dans les tests (le serveur simulé n’implémente pas la variante à
 * titre {@link Component}).
 */
@FunctionalInterface
interface InventoryFactory {

  Inventory create(InventoryHolder holder, int size, Component title);
}

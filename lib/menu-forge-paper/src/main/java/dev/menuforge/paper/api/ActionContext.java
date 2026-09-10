package dev.menuforge.paper.api;

import org.bukkit.entity.Player;
import org.bukkit.event.inventory.ClickType;

/**
 * Contexte d’un clic transmis aux traitements Java.
 *
 * @param player  joueur qui a cliqué
 * @param session sa session de menus
 * @param menuId  menu où le clic a eu lieu
 * @param slotId  id du slot cliqué
 * @param click   type de clic Bukkit
 */
public record ActionContext(Player player, MenuSession session, String menuId, String slotId, ClickType click) {
}

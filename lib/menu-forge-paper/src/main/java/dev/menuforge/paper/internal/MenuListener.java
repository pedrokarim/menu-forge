package dev.menuforge.paper.internal;

import dev.menuforge.model.SlotKind;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/**
 * Sécurise les coffres MenuForge : tout clic est annulé par défaut, sauf dans
 * les slots {@code input} actifs ; le shift-clic depuis l’inventaire du joueur
 * est redirigé vers les slots {@code input} ; le glisser est refusé dès qu’il
 * touche un autre slot du menu.
 */
public final class MenuListener implements Listener {

  private final MenuForgeService service;

  public MenuListener(final MenuForgeService service) {
    this.service = service;
  }

  private static MenuHolder holderOf(final Inventory inventory) {
    return MenuHolder.of(inventory);
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void onClick(final InventoryClickEvent event) {
    final Inventory top = event.getView().getTopInventory();
    final MenuHolder holder = holderOf(top);
    if (holder == null || !(event.getWhoClicked() instanceof Player)) {
      return;
    }
    // Double-clic « ramasser tout » : pourrait aspirer les items du menu.
    if (event.getAction() == InventoryAction.COLLECT_TO_CURSOR) {
      event.setCancelled(true);
      return;
    }
    final int raw = event.getRawSlot();
    final boolean inMenu = raw >= 0 && raw < top.getSize();

    if (!inMenu) {
      // Inventaire du joueur : libre, sauf le shift-clic qui viserait le menu.
      if (event.getAction() == InventoryAction.MOVE_TO_OTHER_INVENTORY) {
        event.setCancelled(true);
        moveIntoInputs(holder, event);
      }
      return;
    }

    if (holder.isOpenInput(raw)) {
      return;
    }
    event.setCancelled(true);

    final SlotBinding binding = holder.binding(raw);
    if (binding == null || !binding.enabled() || binding.slot().kind() == SlotKind.DECORATION
      || binding.slot().kind() == SlotKind.INPUT) {
      return;
    }
    final ClickType click = event.getClick();
    if (click == ClickType.DOUBLE_CLICK || click == ClickType.UNKNOWN || click == ClickType.CREATIVE) {
      return;
    }
    holder.session().handleClick(holder, binding, click);
  }

  /** Répartit l’item shift-cliqué dans les slots {@code input} actifs (fusion d’abord, puis cases vides). */
  private static void moveIntoInputs(final MenuHolder holder, final InventoryClickEvent event) {
    final Inventory clicked = event.getClickedInventory();
    final ItemStack moving = event.getCurrentItem();
    if (clicked == null || moving == null || moving.getType().isAir()) {
      return;
    }
    final Inventory menu = holder.getInventory();
    int remaining = moving.getAmount();
    for (final int slot : holder.inputSlots()) {
      if (remaining <= 0) {
        break;
      }
      final ItemStack there = menu.getItem(slot);
      if (holder.isOpenInput(slot) && there != null && there.isSimilar(moving)) {
        final int moved = Math.min(remaining, there.getMaxStackSize() - there.getAmount());
        if (moved > 0) {
          there.setAmount(there.getAmount() + moved);
          remaining -= moved;
        }
      }
    }
    for (final int slot : holder.inputSlots()) {
      if (remaining <= 0) {
        break;
      }
      final ItemStack there = menu.getItem(slot);
      if (holder.isOpenInput(slot) && (there == null || there.getType().isAir())) {
        final ItemStack placed = moving.clone();
        final int moved = Math.min(remaining, moving.getMaxStackSize());
        placed.setAmount(moved);
        menu.setItem(slot, placed);
        remaining -= moved;
      }
    }
    if (remaining <= 0) {
      clicked.setItem(event.getSlot(), null);
    } else if (remaining != moving.getAmount()) {
      final ItemStack rest = moving.clone();
      rest.setAmount(remaining);
      clicked.setItem(event.getSlot(), rest);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void onDrag(final InventoryDragEvent event) {
    final Inventory top = event.getView().getTopInventory();
    final MenuHolder holder = holderOf(top);
    if (holder == null) {
      return;
    }
    for (final int raw : event.getRawSlots()) {
      if (raw < top.getSize() && !holder.isOpenInput(raw)) {
        event.setCancelled(true);
        return;
      }
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onClose(final InventoryCloseEvent event) {
    final MenuHolder holder = holderOf(event.getInventory());
    if (holder != null) {
      holder.session().onClosed(holder);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(final PlayerQuitEvent event) {
    service.sessions().get(event.getPlayer().getUniqueId()).ifPresent(MenuSessionImpl::forceClose);
  }
}

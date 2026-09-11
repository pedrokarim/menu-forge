package dev.menuforge.paper.internal;

import be.seeseemelk.mockbukkit.entity.PlayerMock;
import org.bukkit.Material;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Verrouillage des clics : tout est annulé sauf les slots {@code input} actifs. */
class ClickLockTest extends MockServerTest {

  /** Premier slot brut de l’inventaire du joueur sous un coffre de 3 lignes (slot 9 de son inventaire). */
  private static final int PLAYER_FIRST_RAW = 27;

  private PlayerMock player;

  @BeforeEach
  void openShop() {
    loadTestMenus();
    player = server.addPlayer();
    service.open(player, "shop");
  }

  @Test
  void buttonsAndDecorationsAreLocked() {
    assertTrue(leftClick(player, 0).isCancelled(), "bouton");
    assertTrue(leftClick(player, 8).isCancelled(), "décoration");
    assertTrue(leftClick(player, 5).isCancelled(), "slot vide du menu");
    assertTrue(click(player, 1, ClickType.SHIFT_LEFT, InventoryAction.MOVE_TO_OTHER_INVENTORY).isCancelled());
    assertTrue(click(player, 1, ClickType.NUMBER_KEY, InventoryAction.HOTBAR_SWAP).isCancelled());
  }

  @Test
  void inputSlotsAndThePlayerInventoryStayFree() {
    assertFalse(leftClick(player, 18).isCancelled(), "slot input");
    assertFalse(leftClick(player, 19).isCancelled(), "slot input");
    assertFalse(leftClick(player, PLAYER_FIRST_RAW + 4).isCancelled(), "inventaire du joueur");
  }

  @Test
  void collectToCursorIsAlwaysBlocked() {
    assertTrue(click(player, PLAYER_FIRST_RAW, ClickType.DOUBLE_CLICK, InventoryAction.COLLECT_TO_CURSOR).isCancelled());
    assertTrue(click(player, 18, ClickType.DOUBLE_CLICK, InventoryAction.COLLECT_TO_CURSOR).isCancelled());
  }

  @Test
  void shiftClickFromThePlayerInventoryGoesIntoInputs() {
    player.getInventory().setItem(9, new ItemStack(Material.STONE, 10));
    final InventoryClickEvent event = click(player, PLAYER_FIRST_RAW, ClickType.SHIFT_LEFT,
      InventoryAction.MOVE_TO_OTHER_INVENTORY);

    assertTrue(event.isCancelled(), "le déplacement vanilla est remplacé");
    final Inventory menu = holder(player).getInventory();
    assertEquals(new ItemStack(Material.STONE, 10), menu.getItem(18));
    assertNull(player.getInventory().getItem(9));
  }

  @Test
  void dragIsRefusedWhenItTouchesALockedSlot() {
    final ItemStack cursor = new ItemStack(Material.STONE, 2);
    final InventoryDragEvent onLocked = new InventoryDragEvent(player.getOpenInventory(), null, cursor, false,
      Map.of(0, new ItemStack(Material.STONE), 18, new ItemStack(Material.STONE)));
    server.getPluginManager().callEvent(onLocked);
    assertTrue(onLocked.isCancelled());

    final InventoryDragEvent onInputs = new InventoryDragEvent(player.getOpenInventory(), null, cursor, false,
      Map.of(18, new ItemStack(Material.STONE), 19, new ItemStack(Material.STONE)));
    server.getPluginManager().callEvent(onInputs);
    assertFalse(onInputs.isCancelled());
  }

  @Test
  void inputItemsFollowRebuildsAndReturnToThePlayerOnClose() {
    holder(player).getInventory().setItem(18, new ItemStack(Material.EMERALD, 3));

    // Changement d’état : le coffre est reconstruit, l’item le suit.
    leftClick(player, 1);
    tick();
    final MenuHolder rebuilt = holder(player);
    assertNotNull(rebuilt);
    assertEquals(new ItemStack(Material.EMERALD, 3), rebuilt.getInventory().getItem(18));

    // Fermeture : l’item est rendu au joueur, la session se termine.
    player.closeInventory();
    assertNull(rebuilt.getInventory().getItem(18));
    assertTrue(player.getInventory().containsAtLeast(new ItemStack(Material.EMERALD), 3));
    assertTrue(service.session(player).isEmpty());
  }
}

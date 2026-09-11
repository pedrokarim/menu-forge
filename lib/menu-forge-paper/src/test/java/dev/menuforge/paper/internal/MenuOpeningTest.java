package dev.menuforge.paper.internal;

import be.seeseemelk.mockbukkit.entity.PlayerMock;
import com.google.gson.JsonObject;
import dev.menuforge.render.SpaceFont;
import org.bukkit.Material;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Ouverture d’un menu : coffre, titre composé, items, drapeaux et variables du serveur. */
class MenuOpeningTest extends MockServerTest {

  @BeforeEach
  void menus() {
    loadTestMenus();
  }

  @Test
  void opensAChestOfTheDeclaredSizeWithASession() {
    final PlayerMock player = server.addPlayer();
    service.open(player, "shop");

    final MenuHolder holder = holder(player);
    assertNotNull(holder, "le coffre ouvert doit être un menu MenuForge");
    assertEquals("shop", holder.menuId());
    assertEquals(27, holder.getInventory().getSize());
    assertEquals("shop", service.session(player).orElseThrow().menuId());
    assertEquals(Map.of("tab", "a"), service.session(player).orElseThrow().state());
    assertEquals(1, service.session(player).orElseThrow().depth());
  }

  @Test
  void titleUsesTheMenuFontThenTheTextFont() {
    final PlayerMock player = server.addPlayer();
    service.open(player, "shop");
    final List<JsonObject> parts = titleParts(holder(player));

    // Couches : recul de −8, fond (U+E000), puis l’onglet « a » (U+E001) ; l’onglet « b » (U+E002) est masqué.
    final JsonObject glyphs = parts.get(0);
    assertEquals("menuforge:menus/shop", glyphs.get("font").getAsString());
    assertEquals("white", glyphs.get("color").getAsString());
    final String run = glyphs.get("text").getAsString();
    assertTrue(run.startsWith(SpaceFont.encode(-8)));
    assertTrue(run.contains(codepoint(0xE000)));
    assertTrue(run.contains(codepoint(0xE001)));
    assertFalse(run.contains(codepoint(0xE002)));

    // Texte en y = 6 → ascent 7, variable d’état interpolée.
    final JsonObject label = parts.get(parts.size() - 1);
    assertEquals("Onglet a", label.get("text").getAsString());
    assertEquals("menuforge:menus/text_7", label.get("font").getAsString());
  }

  @Test
  void rendersButtonsDecorationsAndLeavesInputsEmpty() {
    final PlayerMock player = server.addPlayer();
    service.open(player, "shop");
    final Inventory inventory = holder(player).getInventory();

    // Bouton invisible : l’item configuré (PAPER par défaut), avec son nom MiniMessage.
    final ItemStack tabA = inventory.getItem(0);
    assertNotNull(tabA);
    assertEquals(Material.PAPER, tabA.getType());
    assertEquals("A", plain(tabA.getItemMeta().displayName()));

    final ItemStack decoration = inventory.getItem(8);
    assertEquals(Material.STONE, decoration.getType());
    assertEquals("Déco", plain(decoration.getItemMeta().displayName()));

    assertNull(inventory.getItem(18), "un slot input s’ouvre vide");
    assertNull(inventory.getItem(19));
    assertEquals(Material.BOOK, inventory.getItem(26).getType());
  }

  @Test
  void serverFlagsAndPlaceholdersDriveVisibilityAndText() {
    final PlayerMock staff = server.addPlayer();
    final PlayerMock visitor = server.addPlayer();
    service.registerFlagProvider((viewer, flag) -> "viewer.isStaff".equals(flag) ? viewer == staff : null);
    service.registerPlaceholderResolver((viewer, name) -> "coins".equals(name) ? "42" : null);

    service.open(staff, "shop");
    final ItemStack reward = holder(staff).getInventory().getItem(13);
    assertNotNull(reward, "visibleWhen vrai : le slot est rempli");
    assertEquals("42 pièces", plain(reward.getItemMeta().displayName()));

    service.open(visitor, "shop");
    assertNull(holder(visitor).getInventory().getItem(13), "visibleWhen faux : le slot est vide");
  }

  @Test
  void unregisteredProvidersAreNoLongerAsked() {
    final PlayerMock player = server.addPlayer();
    final dev.menuforge.paper.api.FlagProvider flags = (viewer, flag) -> "viewer.isStaff".equals(flag) ? Boolean.TRUE : null;
    final dev.menuforge.paper.api.PlaceholderResolver coins = (viewer, name) -> "coins".equals(name) ? "42" : null;
    service.registerFlagProvider(flags);
    service.registerPlaceholderResolver(coins);
    service.open(player, "shop");
    assertEquals("42 pièces", plain(holder(player).getInventory().getItem(13).getItemMeta().displayName()));

    service.unregisterFlagProvider(flags);
    service.unregisterPlaceholderResolver(coins);
    service.open(player, "shop");
    assertNull(holder(player).getInventory().getItem(13));
  }

  @Test
  void initialStateIsValidatedAndPagesAreClamped() {
    final PlayerMock player = server.addPlayer();
    service.registerListProvider("entries", request -> List.of());

    assertThrows(IllegalArgumentException.class, () -> service.open(player, "shop", Map.of("tab", "z")));
    assertThrows(IllegalArgumentException.class, () -> service.open(player, "nope"));

    service.open(player, "list", Map.of("page", 9));
    assertEquals(1, service.session(player).orElseThrow().state().get("page"), "liste vide : une seule page");
  }
}

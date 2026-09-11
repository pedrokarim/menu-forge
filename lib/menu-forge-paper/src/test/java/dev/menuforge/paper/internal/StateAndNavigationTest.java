package dev.menuforge.paper.internal;

import be.seeseemelk.mockbukkit.entity.PlayerMock;
import dev.menuforge.paper.api.ActionContext;
import dev.menuforge.paper.api.ListEntry;
import dev.menuforge.paper.api.MenuSession;
import org.bukkit.Material;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** État, reconstruction du titre, pagination, pile de menus et actions custom. */
class StateAndNavigationTest extends MockServerTest {

  private PlayerMock player;

  @BeforeEach
  void setUpMenus() {
    loadTestMenus();
    player = server.addPlayer();
  }

  private String glyphRun() {
    return titleParts(holder(player)).get(0).get("text").getAsString();
  }

  private String lastText() {
    final var parts = titleParts(holder(player));
    return parts.get(parts.size() - 1).get("text").getAsString();
  }

  @Test
  void setStateRebuildsTheChestWithTheNewTitle() {
    service.open(player, "shop");
    final MenuHolder before = holder(player);

    leftClick(player, 1);
    assertTrue(before == holder(player), "rien ne change avant le tick suivant");
    tick();

    final MenuHolder after = holder(player);
    assertNotSame(before, after);
    assertEquals("b", service.session(player).orElseThrow().state().get("tab"));
    assertTrue(glyphRun().contains(codepoint(0xE002)), "onglet « b » affiché");
    assertFalse(glyphRun().contains(codepoint(0xE001)), "onglet « a » masqué");
    assertEquals("Onglet b", lastText());
  }

  @Test
  void setStateFromTheApiIsValidated() {
    service.open(player, "shop");
    final MenuSession session = service.session(player).orElseThrow();
    assertThrows(IllegalArgumentException.class, () -> session.setState("tab", "z"));
    assertThrows(IllegalArgumentException.class, () -> session.setState("nope", "a"));

    session.setState("tab", "b");
    assertEquals("Onglet b", lastText());
  }

  @Test
  void paginationFollowsNextAndPreviousWithinBounds() {
    final List<Integer> clicked = new ArrayList<>();
    service.registerListProvider("entries", request -> IntStream.rangeClosed(1, 10)
      .mapToObj(amount -> ListEntry.of(new ItemStack(Material.STONE, amount),
        (ActionContext context) -> clicked.add(amount)))
      .collect(Collectors.toList()));
    service.open(player, "list");

    assertEquals(List.of(1, 2, 3, 4), amounts());
    assertEquals("1/3", lastText());

    leftClick(player, 16); // précédent : désactivé en page 1
    tick();
    assertEquals(1, page());

    leftClick(player, 17);
    tick();
    assertEquals(2, page());
    assertEquals(List.of(5, 6, 7, 8), amounts());
    assertEquals("2/3", lastText());

    leftClick(player, 17);
    tick();
    assertEquals(List.of(9, 10, 0, 0), amounts());
    leftClick(player, 17); // suivant : désactivé en dernière page
    tick();
    assertEquals(3, page());

    leftClick(player, 16);
    tick();
    assertEquals(2, page());

    // Le clic sur une entrée exécute son traitement Java.
    leftClick(player, 1);
    tick();
    assertEquals(List.of(6), clicked);
  }

  private int page() {
    return (Integer) service.session(player).orElseThrow().state().get("page");
  }

  /** Quantités des 4 cellules de la liste (0 = vide). */
  private List<Integer> amounts() {
    final Inventory inventory = holder(player).getInventory();
    final List<Integer> amounts = new ArrayList<>();
    for (int slot = 0; slot < 4; slot++) {
      final ItemStack item = inventory.getItem(slot);
      amounts.add(item == null ? 0 : item.getAmount());
    }
    return amounts;
  }

  @Test
  void openStacksMenusAndBackUnstacksThenCloses() {
    service.open(player, "shop");
    leftClick(player, 1); // tab = b
    tick();

    leftClick(player, 26); // ouvre « detail »
    tick();
    assertEquals("detail", holder(player).menuId());
    assertEquals(2, service.session(player).orElseThrow().depth());

    leftClick(player, 0); // back
    tick();
    assertEquals("shop", holder(player).menuId());
    assertEquals(1, service.session(player).orElseThrow().depth());
    assertEquals("b", service.session(player).orElseThrow().state().get("tab"), "l’état du menu empilé est conservé");

    service.session(player).orElseThrow().back(); // plus rien dessous : ferme
    assertNull(holder(player));
    assertTrue(service.session(player).isEmpty());
  }

  @Test
  void closeActionEndsTheSession() {
    service.open(player, "shop");
    leftClick(player, 26);
    tick();
    leftClick(player, 8);
    tick();
    assertNull(holder(player));
    assertTrue(service.session(player).isEmpty());
  }

  @Test
  void customActionsReceiveTheirArgsOnlyWhenEnabled() {
    final List<Map<String, Object>> calls = new ArrayList<>();
    final List<String> slots = new ArrayList<>();
    service.registerCustomAction("test:reward", (context, args) -> {
      calls.add(args);
      slots.add(context.slotId());
    });
    service.registerFlagProvider((viewer, flag) -> "viewer.isStaff".equals(flag) ? Boolean.TRUE : null);
    service.open(player, "shop");

    leftClick(player, 13);
    tick();
    assertEquals(1, calls.size());
    assertEquals(5, ((Number) calls.get(0).get("amount")).intValue());
    assertEquals(List.of("staff"), slots);

    leftClick(player, 14); // enabledWhen faux : affiché mais inerte
    tick();
    assertEquals(1, calls.size());
  }

  @Test
  void unknownCustomActionIsLoggedWithoutBreakingTheMenu() {
    service.registerFlagProvider((viewer, flag) -> Boolean.TRUE);
    service.open(player, "shop");
    leftClick(player, 13);
    tick();
    assertEquals("shop", holder(player).menuId());
  }
}

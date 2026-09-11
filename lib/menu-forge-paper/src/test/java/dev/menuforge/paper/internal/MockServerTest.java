package dev.menuforge.paper.internal;

import be.seeseemelk.mockbukkit.MockBukkit;
import be.seeseemelk.mockbukkit.ServerMock;
import be.seeseemelk.mockbukkit.entity.PlayerMock;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.menuforge.paper.MenuForgePlugin;
import dev.menuforge.paper.api.MenuForgeApi;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.InventoryView;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Base des tests du plugin : un serveur MockBukkit (paper-api 1.20.6), le
 * plugin MenuForge chargé, et des outils pour écrire menus et textures dans
 * son espace de travail (dossier temporaire supprimé par MockBukkit).
 */
abstract class MockServerTest {

  /** Menu de test principal : onglets, décoration, dépôt, bouton réservé, navigation. */
  static final String SHOP = """
    { "id": "shop", "name": "Boutique", "container": { "type": "chest", "rows": 3 },
      "state": { "tab": { "type": "enum", "values": ["a", "b"], "default": "a" } },
      "layers": [
        { "id": "bg", "texture": "shop/bg.png", "x": 0, "y": 0 },
        { "id": "tab_a_on", "texture": "shop/tab.png", "x": 7, "y": 17, "visibleWhen": { "state": "tab", "is": "a" } },
        { "id": "tab_b_on", "texture": "shop/tab.png", "x": 25, "y": 17, "visibleWhen": { "state": "tab", "is": "b" } }
      ],
      "texts": [{ "id": "label", "x": 8, "y": 6, "value": "Onglet {state.tab}" }],
      "slots": [
        { "id": "tab_a", "kind": "button", "area": { "col": 0, "row": 0 },
          "item": { "invisible": true, "name": "<green>A" },
          "onClick": [{ "type": "setState", "state": "tab", "value": "a" }] },
        { "id": "tab_b", "kind": "button", "area": { "col": 1, "row": 0 },
          "item": { "invisible": true, "name": "B" },
          "onClick": [{ "type": "setState", "state": "tab", "value": "b" }] },
        { "id": "deco", "kind": "decoration", "area": { "col": 8, "row": 0 }, "item": { "material": "STONE", "name": "Déco" } },
        { "id": "deposit", "kind": "input", "area": { "col": 0, "row": 2, "width": 2 } },
        { "id": "staff", "kind": "button", "area": { "col": 4, "row": 1 },
          "item": { "material": "DIAMOND", "name": "{coins} pièces" },
          "visibleWhen": { "flag": "viewer.isStaff" },
          "onClick": [{ "type": "custom", "id": "test:reward", "args": { "amount": 5 } }] },
        { "id": "locked", "kind": "button", "area": { "col": 5, "row": 1 }, "item": { "material": "BARRIER" },
          "enabledWhen": { "flag": "never" },
          "onClick": [{ "type": "custom", "id": "test:reward" }] },
        { "id": "detail", "kind": "button", "area": { "col": 8, "row": 2 }, "item": { "material": "BOOK" },
          "onClick": [{ "type": "open", "menu": "detail" }] }
      ] }
    """;

  /** Menu empilé par {@code shop} : retour et fermeture. */
  static final String DETAIL = """
    { "id": "detail", "container": { "type": "chest", "rows": 1 },
      "slots": [
        { "id": "back", "kind": "button", "area": { "col": 0, "row": 0 }, "item": { "material": "ARROW" },
          "onClick": [{ "type": "back" }] },
        { "id": "close", "kind": "button", "area": { "col": 8, "row": 0 }, "item": { "material": "BARRIER" },
          "onClick": [{ "type": "close" }] }
      ] }
    """;

  /** Liste paginée de 4 cellules. */
  static final String LIST = """
    { "id": "list", "container": { "type": "chest", "rows": 2 },
      "state": { "page": { "type": "page", "list": "entries" } },
      "texts": [{ "id": "label", "x": 88, "y": 20, "align": "center", "value": "{page.number}/{page.count}" }],
      "slots": [
        { "id": "grid", "kind": "list", "list": "entries", "area": { "col": 0, "row": 0, "width": 4 } },
        { "id": "prev", "kind": "button", "area": { "col": 7, "row": 1 }, "item": { "material": "ARROW" },
          "enabledWhen": { "flag": "page.hasPrev" }, "onClick": [{ "type": "prevPage", "list": "entries" }] },
        { "id": "next", "kind": "button", "area": { "col": 8, "row": 1 }, "item": { "material": "ARROW" },
          "enabledWhen": { "flag": "page.hasNext" }, "onClick": [{ "type": "nextPage", "list": "entries" }] }
      ] }
    """;

  ServerMock server;
  MenuForgePlugin plugin;
  MenuForgeService service;
  Path workspace;

  @BeforeEach
  void startServer() {
    server = MockBukkit.mock();
    plugin = MockBukkit.load(MenuForgePlugin.class);
    service = (MenuForgeService) MenuForgeApi.get();
    // MockBukkit 3.93 n’implémente pas createInventory(holder, taille, Component)
    // (Paper) : on passe par la variante à titre texte. Le titre réel se
    // vérifie par MenuHolder#titleJson().
    service.setInventoryFactory((InventoryHolder holder, int size, Component title) ->
      server.createInventory(holder, size, plain(title)));
    workspace = plugin.getDataFolder().toPath().resolve("workspace");
  }

  @AfterEach
  void stopServer() {
    MockBukkit.unmock();
  }

  /** Écrit {@code json} dans {@code <espace>/menus/<id>.menu.json}. */
  static void writeMenu(final Path root, final String id, final String json) {
    try {
      final Path file = root.resolve("menus").resolve(id + ".menu.json");
      Files.createDirectories(file.getParent());
      Files.writeString(file, json, StandardCharsets.UTF_8);
    } catch (final IOException exception) {
      throw new UncheckedIOException(exception);
    }
  }

  /** Écrit une texture opaque {@code width × height} dans {@code <espace>/textures/<path>}. */
  static void writeTexture(final Path root, final String path, final int width, final int height) {
    final BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        image.setRGB(x, y, 0xFF808080);
      }
    }
    try {
      final Path file = root.resolve("textures").resolve(path);
      Files.createDirectories(file.getParent());
      ImageIO.write(image, "png", file.toFile());
    } catch (final IOException exception) {
      throw new UncheckedIOException(exception);
    }
  }

  /** Écrit les menus de test et leurs textures, puis recharge (sans erreur attendue). */
  void loadTestMenus() {
    writeMenu(workspace, "shop", SHOP);
    writeMenu(workspace, "detail", DETAIL);
    writeMenu(workspace, "list", LIST);
    writeTexture(workspace, "shop/bg.png", 176, 80);
    writeTexture(workspace, "shop/tab.png", 18, 18);
    final MenuForgeService.ReloadReport report = service.reloadWorkspace();
    assertEquals(List.of(), report.errors());
  }

  /** Porteur du coffre ouvert par le joueur, ou {@code null} si ce n’est pas un menu MenuForge. */
  static MenuHolder holder(final PlayerMock player) {
    return MenuHolder.of(player.getOpenInventory().getTopInventory());
  }

  /** Simule un clic sur le slot brut {@code rawSlot} de la vue ouverte. */
  InventoryClickEvent click(final PlayerMock player, final int rawSlot, final ClickType type,
                            final InventoryAction action) {
    final InventoryView view = player.getOpenInventory();
    final InventoryClickEvent event = new InventoryClickEvent(view, InventoryType.SlotType.CONTAINER, rawSlot, type, action);
    server.getPluginManager().callEvent(event);
    return event;
  }

  /** Clic gauche ordinaire. */
  InventoryClickEvent leftClick(final PlayerMock player, final int rawSlot) {
    return click(player, rawSlot, ClickType.LEFT, InventoryAction.PICKUP_ALL);
  }

  /** Avance d’un tick (les actions s’exécutent au tick suivant le clic). */
  void tick() {
    server.getScheduler().performOneTick();
  }

  static String plain(final Component component) {
    return component == null ? null : PlainTextComponentSerializer.plainText().serialize(component);
  }

  /** Composants {@code extra} du titre JSON. */
  static List<JsonObject> titleParts(final MenuHolder holder) {
    final JsonArray extra = JsonParser.parseString(holder.titleJson()).getAsJsonObject().getAsJsonArray("extra");
    final List<JsonObject> parts = new ArrayList<>();
    extra.forEach(element -> parts.add(element.getAsJsonObject()));
    return parts;
  }

  /** Chaîne d’un seul point de code (évite les échappements dans les sources). */
  static String codepoint(final int value) {
    return new String(Character.toChars(value));
  }
}

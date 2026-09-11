package dev.menuforge.parse;

import dev.menuforge.TestMenus;
import dev.menuforge.model.Action;
import dev.menuforge.model.Condition;
import dev.menuforge.model.Include;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.Slot;
import dev.menuforge.model.SlotKind;
import dev.menuforge.model.StateDefinition;
import dev.menuforge.model.TextAlign;
import dev.menuforge.model.TextElement;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MenuParserTest {

  @Test
  void parsesTheFormatDocumentationExample() {
    final MenuDefinition menu = TestMenus.menu("badges");

    assertEquals(1, menu.formatVersion());
    assertEquals("badges", menu.id());
    assertEquals("Succès", menu.name());
    assertFalse(menu.template());
    assertEquals(List.of("navigation"), menu.parents());
    assertEquals(6, menu.container().rows());
    assertEquals(54, menu.container().size());

    final StateDefinition tab = menu.state().get("tab");
    assertInstanceOf(StateDefinition.EnumState.class, tab);
    assertEquals("progress", tab.initialValue());
    final StateDefinition page = menu.state().get("page");
    assertEquals(new StateDefinition.PageState("badges"), page);
    assertEquals(List.of("tab", "page"), List.copyOf(menu.state().keySet()));

    assertEquals(3, menu.layers().size());
    assertEquals("badges/background.png", menu.layers().get(0).texture());
    assertEquals(0, menu.layers().get(0).x());
    assertEquals(33, menu.layers().get(0).y());
    assertNull(menu.layers().get(0).visibleWhen());
    assertEquals(new Condition.Is("tab", "progress"), menu.layers().get(1).visibleWhen());
    assertEquals(new Condition.Flag("page.hasNext"), menu.layers().get(2).visibleWhen());

    final TextElement label = menu.texts().get(0);
    assertEquals(TextAlign.CENTER, label.align());
    assertEquals("#404040", label.color());
    assertEquals("{page.number}/{page.count}", label.value());

    final Slot tabButton = menu.slots().get(0);
    assertEquals(SlotKind.BUTTON, tabButton.kind());
    assertTrue(tabButton.item().invisible());
    assertEquals("<green>Progression", tabButton.item().name());
    assertEquals(List.of(new Action.SetState("tab", "progress")), tabButton.onClick());

    final Slot grid = menu.slots().get(1);
    assertEquals(SlotKind.LIST, grid.kind());
    assertEquals("badges", grid.list());
    assertEquals(18, grid.area().size());
    assertEquals(20, grid.area().slotIndices().get(0));

    final Slot next = menu.slots().get(2);
    assertEquals(new Condition.Flag("page.hasNext"), next.enabledWhen());
    assertEquals(List.of(new Action.NextPage("badges")), next.onClick());
  }

  @Test
  void readsABedrockFormWithoutJavaRendering() {
    final MenuDefinition form = new MenuParser().parse("""
      { "formatVersion": 1, "id": "hub", "name": "Hub",
        "state": { "vip": { "type": "bool", "default": false } },
        "form": { "layout": "grid", "title": "§6Hub", "content": "Choisis",
          "buttons": [{ "id": "spawn", "text": "Spawn", "icon": { "path": "textures/items/compass_item" },
                        "onClick": [{ "type": "command", "command": "spawn" }, { "type": "close" }] }] } }
      """, "hub.menu.json");
    assertTrue(form.bedrockForm());
    assertNull(form.container());
    assertTrue(form.layers().isEmpty());
    assertTrue(form.slots().isEmpty());
    assertEquals(List.of("vip"), List.copyOf(form.state().keySet()));
    assertFalse(TestMenus.menu("badges").bedrockForm());
    assertThrows(MenuFormatException.class, () -> new MenuParser().parse("{ \"id\": \"x\", \"form\": 3 }", "x.menu.json"));
  }

  @Test
  void ignoresTheStudioGeneratorMetadata() {
    final MenuDefinition navigation = TestMenus.menu("navigation");
    assertTrue(navigation.template());
    assertEquals("navbar", navigation.layers().get(0).id());
    assertEquals(15, navigation.layers().get(0).y());
  }

  @Test
  void ignoresTheStudioEditorFlags() {
    // « editor » (verrouillé, masqué dans l’éditeur) est une métadonnée du studio :
    // l’élément reste lu, exporté et affiché en jeu.
    final MenuDefinition menu = TestMenus.parse("""
      { "formatVersion": 1, "id": "flags",
        "layers": [{ "id": "bg", "texture": "bg.png", "x": 0, "y": 2, "editor": { "locked": true, "hidden": true } }],
        "texts": [{ "id": "t", "x": 8, "y": 6, "value": "Titre", "editor": { "hidden": true } }],
        "slots": [{ "id": "s", "kind": "button", "area": { "col": 3, "row": 1 }, "editor": { "locked": true } }] }
      """);
    assertEquals(1, menu.layers().size());
    assertEquals("bg.png", menu.layers().get(0).texture());
    assertEquals(2, menu.layers().get(0).y());
    assertEquals("Titre", menu.texts().get(0).value());
    assertEquals(SlotKind.BUTTON, menu.slots().get(0).kind());
    assertEquals(List.of(12), menu.slots().get(0).area().slotIndices());
  }

  @Test
  void parsesEveryActionAndConditionType() {
    final MenuDefinition menu = TestMenus.parse("""
      {
        "formatVersion": 1, "id": "all_types",
        "state": {
          "flagged": { "type": "bool", "default": true },
          "count": { "type": "int", "default": 2, "min": 0, "max": 5 }
        },
        "slots": [{
          "id": "s", "kind": "button", "area": { "col": 1, "row": 0, "width": 2 },
          "visibleWhen": { "all": [
            { "any": [{ "state": "count", "in": [1, 2] }, { "flag": "viewer.isStaff" }] },
            { "not": { "state": "flagged", "is": false } }
          ] },
          "onClick": [
            { "type": "open", "menu": "shop", "state": { "tab": "food" } },
            { "type": "back" }, { "type": "close" },
            { "type": "prevPage", "list": "items" },
            { "type": "sound", "sound": "minecraft:ui.button.click", "pitch": 1.5 },
            { "type": "command", "command": "spawn", "as": "console" },
            { "type": "custom", "id": "enderium:reward", "args": { "amount": 3, "tags": ["a", "b"] } }
          ]
        }]
      }
      """);
    final Slot slot = menu.slots().get(0);
    assertEquals(List.of(1, 2), slot.area().slotIndices());
    assertInstanceOf(Condition.All.class, slot.visibleWhen());
    assertEquals(new Action.Open("shop", java.util.Map.of("tab", "food")), slot.onClick().get(0));
    assertEquals(new Action.Sound("minecraft:ui.button.click", 1.0f, 1.5f), slot.onClick().get(4));
    assertEquals(new Action.Command("spawn", Action.CommandSender.CONSOLE), slot.onClick().get(5));
    final Action.Custom custom = (Action.Custom) slot.onClick().get(6);
    assertEquals(3L, custom.args().get("amount"));
    assertEquals(List.of("a", "b"), custom.args().get("tags"));
  }

  @Test
  void parsesComponentsAndIncludes() {
    final MenuDefinition menu = TestMenus.parse("""
      { "formatVersion": 1, "id": "shop", "component": true,
        "includes": [
          { "component": "pager", "prefix": "p_", "col": 1, "row": -2, "x": 3, "y": 4,
            "visibleWhen": { "flag": "viewer.isStaff" } },
          { "component": "back_button" }
        ] }
      """);
    assertTrue(menu.component());
    assertTrue(menu.partial());
    assertFalse(menu.template());
    assertEquals(new Include("pager", "p_", 1, -2, 3, 4, new Condition.Flag("viewer.isStaff")), menu.includes().get(0));
    assertEquals(Include.of("back_button"), menu.includes().get(1));
    assertTrue(TestMenus.menu("badges").includes().isEmpty());
  }

  @Test
  void reportsInvalidIncludes() {
    assertEquals("$.includes[0].component", assertThrows(MenuFormatException.class,
      () -> TestMenus.parse("{ \"id\": \"x\", \"includes\": [{ \"prefix\": \"a_\" }] }")).path());
    assertEquals("$.includes[0].component", assertThrows(MenuFormatException.class,
      () -> TestMenus.parse("{ \"id\": \"x\", \"includes\": [{ \"component\": \"Pager\" }] }")).path());
    assertEquals("$.includes[1].prefix", assertThrows(MenuFormatException.class, () -> TestMenus.parse(
      "{ \"id\": \"x\", \"includes\": [{ \"component\": \"a\" }, { \"component\": \"b\", \"prefix\": \"B-\" }] }")).path());
    assertEquals("$.includes[0].col", assertThrows(MenuFormatException.class,
      () -> TestMenus.parse("{ \"id\": \"x\", \"includes\": [{ \"component\": \"a\", \"col\": 1.5 }] }")).path());
  }

  @Test
  void reportsThePathOfAWronglyTypedKey() {
    final MenuFormatException error = assertThrows(MenuFormatException.class, () -> TestMenus.parse("""
      { "formatVersion": 1, "id": "broken",
        "layers": [
          { "id": "a", "texture": "a.png", "x": 0, "y": 0 },
          { "id": "b", "texture": "b.png", "x": "left", "y": 0 }
        ] }
      """));
    assertEquals("$.layers[1].x", error.path());
    assertTrue(error.getMessage().contains("test.menu.json"), error.getMessage());
    assertTrue(error.getMessage().contains("entier attendu"), error.getMessage());
  }

  @Test
  void reportsMissingKeysAndBadValues() {
    assertEquals("$.id", assertThrows(MenuFormatException.class,
      () -> TestMenus.parse("{ \"formatVersion\": 1 }")).path());
    assertEquals("$.id", assertThrows(MenuFormatException.class,
      () -> TestMenus.parse("{ \"id\": \"Bad-Id\" }")).path());
    assertEquals("$.formatVersion", assertThrows(MenuFormatException.class,
      () -> TestMenus.parse("{ \"formatVersion\": 2, \"id\": \"x\" }")).path());
    assertEquals("$.slots[0].kind", assertThrows(MenuFormatException.class, () -> TestMenus.parse(
      "{ \"id\": \"x\", \"slots\": [{ \"id\": \"s\", \"kind\": \"lever\", \"area\": { \"col\": 0, \"row\": 0 } }] }")).path());
    assertEquals("$.slots[0].visibleWhen", assertThrows(MenuFormatException.class, () -> TestMenus.parse(
      "{ \"id\": \"x\", \"slots\": [{ \"id\": \"s\", \"kind\": \"button\", \"area\": { \"col\": 0, \"row\": 0 },"
        + " \"visibleWhen\": { \"state\": \"tab\" } }] }")).path());
    assertEquals("$.texts[0].color", assertThrows(MenuFormatException.class, () -> TestMenus.parse(
      "{ \"id\": \"x\", \"texts\": [{ \"id\": \"t\", \"x\": 0, \"y\": 10, \"value\": \"a\", \"color\": \"red\" }] }")).path());
    assertEquals("$", assertThrows(MenuFormatException.class, () -> TestMenus.parse("{ \"id\": ")).path());
  }
}

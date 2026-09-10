package dev.menuforge.template;

import dev.menuforge.TestMenus;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.StateDefinition;
import dev.menuforge.parse.MenuValidator;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TemplateResolverTest {

  private static TemplateResolver resolver(final MenuDefinition... menus) {
    final Map<String, MenuDefinition> byId = new HashMap<>();
    for (final MenuDefinition menu : menus) {
      byId.put(menu.id(), menu);
    }
    return new TemplateResolver(byId::get);
  }

  private static List<String> layerIds(final MenuDefinition menu) {
    return menu.layers().stream().map(Layer::id).collect(Collectors.toList());
  }

  @Test
  void templateLayersComeFirstAndSameIdReplacesInPlace() {
    final MenuDefinition navigation = TestMenus.menu("navigation");
    final MenuDefinition badges = TestMenus.menu("badges");

    final MenuDefinition resolved = resolver(navigation, badges).resolve(badges);

    // « background » du menu remplace celui du gabarit, à la position du gabarit.
    assertEquals(List.of("navbar", "background", "tab_progress_on", "next_page_on"), layerIds(resolved));
    assertEquals("badges/background.png", resolved.layer("background").texture());
    // Slots : ceux du gabarit d’abord.
    assertEquals(List.of("back", "tab_progress", "grid", "next"),
      resolved.slots().stream().map(slot -> slot.id()).collect(Collectors.toList()));
    // État : fusion clé par clé, le menu gagne.
    assertEquals(List.of("progress", "discovery", "challenge"),
      ((StateDefinition.EnumState) resolved.state().get("tab")).values());
    assertTrue(resolved.parents().isEmpty());
    assertEquals(6, resolved.container().rows());
    MenuValidator.validate(resolved);
  }

  @Test
  void templatesApplyInListOrder() {
    final MenuDefinition first = TestMenus.parse("""
      { "id": "first", "template": true, "container": { "rows": 3 },
        "layers": [{ "id": "a", "texture": "first_a.png", "x": 0, "y": 0 },
                   { "id": "b", "texture": "first_b.png", "x": 0, "y": 0 }] }
      """);
    final MenuDefinition second = TestMenus.parse("""
      { "id": "second", "template": true, "container": { "rows": 4 },
        "layers": [{ "id": "b", "texture": "second_b.png", "x": 0, "y": 0 },
                   { "id": "c", "texture": "second_c.png", "x": 0, "y": 0 }] }
      """);
    final MenuDefinition menu = TestMenus.parse("""
      { "id": "menu", "extends": ["first", "second"],
        "layers": [{ "id": "a", "texture": "menu_a.png", "x": 0, "y": 0 },
                   { "id": "d", "texture": "menu_d.png", "x": 0, "y": 0 }] }
      """);

    final MenuDefinition resolved = resolver(first, second, menu).resolve(menu);

    assertEquals(List.of("a", "b", "c", "d"), layerIds(resolved));
    assertEquals("menu_a.png", resolved.layer("a").texture());
    assertEquals("second_b.png", resolved.layer("b").texture());
    assertEquals(4, resolved.container().rows(), "le dernier gabarit qui déclare un conteneur gagne");
  }

  @Test
  void nestedTemplatesAreResolvedFirst() {
    final MenuDefinition base = TestMenus.parse("""
      { "id": "base", "template": true, "texts": [{ "id": "t", "x": 8, "y": 6, "value": "base" }] }
      """);
    final MenuDefinition middle = TestMenus.parse("""
      { "id": "middle", "template": true, "extends": ["base"],
        "texts": [{ "id": "t", "x": 8, "y": 6, "value": "middle" }, { "id": "u", "x": 8, "y": 20, "value": "u" }] }
      """);
    final MenuDefinition menu = TestMenus.parse("{ \"id\": \"menu\", \"extends\": [\"middle\"] }");

    final MenuDefinition resolved = resolver(base, middle, menu).resolve(menu);
    assertEquals(2, resolved.texts().size());
    assertEquals("middle", resolved.texts().get(0).value());
    assertEquals(6, resolved.container().rows(), "coffre de 6 lignes par défaut");
  }

  @Test
  void detectsCycles() {
    final MenuDefinition a = TestMenus.parse("{ \"id\": \"a\", \"template\": true, \"extends\": [\"b\"] }");
    final MenuDefinition b = TestMenus.parse("{ \"id\": \"b\", \"template\": true, \"extends\": [\"a\"] }");
    final MenuDefinition menu = TestMenus.parse("{ \"id\": \"menu\", \"extends\": [\"a\"] }");

    final TemplateResolutionException error = assertThrows(TemplateResolutionException.class,
      () -> resolver(a, b, menu).resolve(menu));
    assertTrue(error.getMessage().contains("a → b → a"), error.getMessage());

    final MenuDefinition self = TestMenus.parse("{ \"id\": \"self\", \"extends\": [\"self\"] }");
    assertThrows(TemplateResolutionException.class, () -> resolver(self).resolve(self));
  }

  @Test
  void reportsMissingTemplates() {
    final MenuDefinition menu = TestMenus.parse("{ \"id\": \"menu\", \"extends\": [\"ghost\"] }");
    final TemplateResolutionException error = assertThrows(TemplateResolutionException.class,
      () -> resolver(menu).resolve(menu));
    assertTrue(error.getMessage().contains("ghost"), error.getMessage());
  }
}

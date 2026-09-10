package dev.menuforge.render;

import dev.menuforge.TestMenus;
import dev.menuforge.image.ImageBounds;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.state.ConditionContext;
import dev.menuforge.state.StateSnapshot;
import dev.menuforge.text.CharWidths;
import dev.menuforge.text.VariableResolver;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TitleComposerTest {

  private static Function<String, Optional<ImageBounds>> bounds(final Map<String, ImageBounds> byTexture) {
    return texture -> Optional.ofNullable(byTexture.get(texture));
  }

  @Test
  void croppedLayerIsShiftedToItsFirstVisiblePixel() {
    final MenuDefinition menu = TestMenus.parse("""
      { "id": "m", "layers": [{ "id": "button", "texture": "button.png", "x": 10, "y": 40 }] }
      """);
    // Pixels visibles de la texture : colonnes 3 à 7, lignes 2 à 5.
    final List<TitleToken> tokens = TitleComposer.compose(menu, ConditionContext.EMPTY,
      bounds(Map.of("button.png", new ImageBounds(3, 2, 5, 4))), VariableResolver.NONE);

    // x = 10 + 3 = 13 ; top = 40 + 2 = 42 ; ascent = 13 − 42 = −29 ; height = max(4, −29) = 4 ; avance = 6.
    assertEquals(List.of(
      new TitleToken.Shift(-8),
      new TitleToken.Shift(13),
      new TitleToken.Glyph("button", -29, 4, 6)
    ), tokens);
  }

  @Test
  void layerNearTheTopRequiresBottomPadding() {
    final MenuDefinition menu = TestMenus.parse("""
      { "id": "m", "layers": [
        { "id": "bar", "texture": "bar.png", "x": 0, "y": 0 },
        { "id": "icon", "texture": "icon.png", "x": 20, "y": 3 }
      ] }
      """);
    final List<TitleToken> tokens = TitleComposer.compose(menu, ConditionContext.EMPTY, bounds(Map.of(
      "bar.png", new ImageBounds(0, 0, 176, 5),
      "icon.png", new ImageBounds(1, 0, 8, 8)
    )), VariableResolver.NONE);

    // bar : ascent 13 > hauteur 5 → height 13. Pas de décalage (x = curseur = 0).
    // icon : x = 21, top = 3, ascent 10 > 8 → height 10 ; curseur après bar = 177 → décalage −156.
    assertEquals(List.of(
      new TitleToken.Shift(-8),
      new TitleToken.Glyph("bar", 13, 13, 177),
      new TitleToken.Shift(21 - 177),
      new TitleToken.Glyph("icon", 10, 10, 9)
    ), tokens);
  }

  @Test
  void centeredTextUsesTheAdvanceTable() {
    final MenuDefinition menu = TestMenus.parse("""
      { "id": "m",
        "state": { "page": { "type": "page", "list": "items" } },
        "layers": [{ "id": "bg", "texture": "bg.png", "x": 0, "y": 33 }],
        "texts": [
          { "id": "label", "x": 88, "y": 116, "align": "center", "color": "#404040", "value": "{page.number}/{page.count}" },
          { "id": "right", "x": 170, "y": 20, "align": "right", "value": "Il" }
        ] }
      """);
    final StateSnapshot snapshot = StateSnapshot.of(menu.state(), Map.of("page", 3), Map.of("page", 46));
    final List<TitleToken> tokens = TitleComposer.compose(menu, snapshot.context(Set.of()),
      bounds(Map.of("bg.png", new ImageBounds(0, 0, 176, 100))), snapshot.asResolver());

    // "3/46" : 4 caractères de largeur 5 → 4 × 6 = 24 ; début = 88 − 12 = 76 ; curseur après bg = 177.
    // "Il" : I (3 + 1) + l (2 + 1) = 7 ; début = 170 − 7 = 163 ; curseur après le 1er texte = 100.
    assertEquals(24, CharWidths.width("3/46"));
    assertEquals(List.of(
      new TitleToken.Shift(-8),
      new TitleToken.Glyph("bg", -20, 100, 177),
      new TitleToken.Shift(76 - 177),
      new TitleToken.Text("3/46", -103, "#404040"),
      new TitleToken.Shift(163 - 100),
      new TitleToken.Text("Il", -7, null)
    ), tokens);
  }

  @Test
  void centeredOddWidthRoundsTowardsTheLeft() {
    final MenuDefinition menu = TestMenus.parse("""
      { "id": "m", "texts": [{ "id": "t", "x": 50, "y": 10, "align": "center", "value": "Il" }] }
      """);
    final List<TitleToken> tokens = TitleComposer.compose(menu, ConditionContext.EMPTY,
      texture -> Optional.empty(), VariableResolver.NONE);
    // largeur 7 → floor(7 / 2) = 3 → début 47.
    assertEquals(List.of(new TitleToken.Shift(-8), new TitleToken.Shift(47), new TitleToken.Text("Il", 3, null)), tokens);
  }

  @Test
  void hiddenAndEmptyLayersAreSkipped() {
    final MenuDefinition menu = TestMenus.parse("""
      { "id": "m",
        "state": { "tab": { "type": "enum", "values": ["a", "b"], "default": "a" } },
        "layers": [
          { "id": "empty", "texture": "empty.png", "x": 0, "y": 0 },
          { "id": "on_b", "texture": "b.png", "x": 0, "y": 20, "visibleWhen": { "state": "tab", "is": "b" } },
          { "id": "on_a", "texture": "a.png", "x": 0, "y": 20, "visibleWhen": { "state": "tab", "is": "a" } }
        ] }
      """);
    final ConditionContext context = StateSnapshot.of(menu.state(), Map.of(), Map.of()).context(Set.of());
    final List<TitleToken> tokens = TitleComposer.compose(menu, context, bounds(Map.of(
      "a.png", new ImageBounds(0, 0, 10, 10),
      "b.png", new ImageBounds(0, 0, 10, 10)
    )), VariableResolver.NONE);
    assertEquals(List.of(new TitleToken.Shift(-8), new TitleToken.Glyph("on_a", -7, 10, 11)), tokens);
  }

  @Test
  void unknownVariablesStayVisible() {
    final MenuDefinition menu = TestMenus.parse("""
      { "id": "m", "texts": [{ "id": "t", "x": 8, "y": 6, "value": "Hi {viewer.name} {mystery}" }] }
      """);
    final List<TitleToken> tokens = TitleComposer.compose(menu, ConditionContext.EMPTY, texture -> Optional.empty(),
      name -> "viewer.name".equals(name) ? "Steve" : null);
    assertEquals(new TitleToken.Text("Hi Steve {mystery}", 7, null), tokens.get(2));
  }
}

package dev.menuforge.render;

import dev.menuforge.image.ImageBounds;
import dev.menuforge.image.TextureLibrary;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.state.ConditionContext;
import dev.menuforge.text.VariableResolver;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Menu résolu prêt à l’affichage : mesures de ses textures et codepoints de sa
 * police calculés une fois pour toutes. Composer un titre ne touche alors plus
 * aux images.
 */
public final class CompiledMenu {

  private final MenuDefinition menu;
  private final Map<String, Optional<ImageBounds>> bounds;
  private final FontLayout layout;

  private CompiledMenu(final MenuDefinition menu, final Map<String, Optional<ImageBounds>> bounds) {
    this.menu = menu;
    this.bounds = Collections.unmodifiableMap(bounds);
    this.layout = FontLayout.of(menu, this::bounds);
  }

  /**
   * Mesure toutes les textures du menu.
   *
   * @throws dev.menuforge.MenuForgeException si une texture est introuvable ou illisible
   */
  public static CompiledMenu compile(final MenuDefinition resolvedMenu, final TextureLibrary textures) {
    final Map<String, Optional<ImageBounds>> bounds = new HashMap<>();
    for (final Layer layer : resolvedMenu.layers()) {
      bounds.computeIfAbsent(layer.texture(), textures::bounds);
    }
    return new CompiledMenu(resolvedMenu, bounds);
  }

  /** Zone visible d’une texture du menu (vide si transparente ou inconnue). */
  public Optional<ImageBounds> bounds(final String texture) {
    return bounds.getOrDefault(texture, Optional.empty());
  }

  /** Jetons du titre pour ce contexte. */
  public List<TitleToken> tokens(final ConditionContext context, final VariableResolver variables) {
    return TitleComposer.compose(menu, context, this::bounds, variables);
  }

  /** Titre JSON pour ce contexte. */
  public String titleJson(final TitleRenderer renderer, final ConditionContext context,
                          final VariableResolver variables) {
    return renderer.render(menu.id(), layout, tokens(context, variables));
  }

  /** Menu résolu. */
  public MenuDefinition menu() {
    return menu;
  }

  /** Codepoints de la police du menu. */
  public FontLayout layout() {
    return layout;
  }
}

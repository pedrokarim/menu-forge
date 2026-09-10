package dev.menuforge.render;

import dev.menuforge.MenuForgeException;
import dev.menuforge.image.ImageBounds;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

/**
 * Attribution des codepoints de la police d’un menu : chaque couche dont la
 * texture n’est pas vide reçoit, dans l’ordre résolu, un codepoint de la zone
 * privée à partir de {@code U+E000}. Chaque menu ayant sa police, les mêmes
 * codepoints sont réutilisés d’un menu à l’autre.
 */
public final class FontLayout {

  /** Premier codepoint des couches. */
  public static final int FIRST_CODEPOINT = 0xE000;
  /** Dernier codepoint utilisable (les espacements commencent en {@code U+F801}). */
  public static final int LAST_CODEPOINT = 0xF7FF;

  private final Map<String, Integer> codepoints;

  private FontLayout(final Map<String, Integer> codepoints) {
    this.codepoints = Collections.unmodifiableMap(codepoints);
  }

  /** Calcule l’attribution pour un menu résolu. */
  public static FontLayout of(final MenuDefinition menu, final Function<String, Optional<ImageBounds>> bounds) {
    final Map<String, Integer> codepoints = new LinkedHashMap<>();
    int next = FIRST_CODEPOINT;
    for (final Layer layer : menu.layers()) {
      if (bounds.apply(layer.texture()).isEmpty() || codepoints.containsKey(layer.id())) {
        continue;
      }
      if (next > LAST_CODEPOINT) {
        throw new MenuForgeException("menu « " + menu.id() + " » : trop de couches pour une seule police");
      }
      codepoints.put(layer.id(), next++);
    }
    return new FontLayout(codepoints);
  }

  /** Codepoint de la couche, ou exception si elle n’a pas de glyphe (texture vide). */
  public int codepoint(final String layerId) {
    final Integer codepoint = codepoints.get(layerId);
    if (codepoint == null) {
      throw new MenuForgeException("la couche « " + layerId + " » n’a pas de glyphe");
    }
    return codepoint;
  }

  /** Attribution complète, dans l’ordre des couches. */
  public Map<String, Integer> codepoints() {
    return codepoints;
  }
}

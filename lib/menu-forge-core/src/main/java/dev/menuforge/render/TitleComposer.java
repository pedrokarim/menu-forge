package dev.menuforge.render;

import dev.menuforge.image.ImageBounds;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.TextElement;
import dev.menuforge.state.ConditionContext;
import dev.menuforge.text.CharWidths;
import dev.menuforge.text.VariableResolver;
import dev.menuforge.text.Variables;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

/**
 * Compose le titre d’un menu en jetons ({@link TitleToken}).
 *
 * <p>Algorithme (identique dans le studio) :
 * <pre>
 * tokens = [shift(-TITLE_X)] ; cursor = 0
 * pour chaque couche visible (ordre résolu) :
 *   b = bounds(texture) ; si vide → ignorer
 *   x = layer.x + b.cropX ; top = layer.y + b.cropY
 *   ascent = TITLE_Y + 7 - top ; height = max(b.height, ascent) ; advance = b.width + 1
 *   tokens += shift(x - cursor) (omis si 0), glyph(layer, ascent, height, advance)
 *   cursor = x + advance
 * pour chaque texte visible :
 *   value = interpolation ; width = somme des avances
 *   start = x | x - floor(width/2) | x - width   (left | center | right)
 *   tokens += shift(start - cursor) (omis si 0), text(value, 13 - y, color)
 *   cursor = start + width
 * </pre>
 */
public final class TitleComposer {

  /** Abscisse (pixels fenêtre) où Minecraft dessine le titre d’un coffre. */
  public static final int TITLE_X = 8;
  /** Ordonnée (pixels fenêtre) où Minecraft dessine le titre d’un coffre. */
  public static final int TITLE_Y = 6;

  private TitleComposer() {
  }

  /**
   * Compose les jetons du titre.
   *
   * @param menu      menu résolu
   * @param context   contexte d’évaluation des conditions
   * @param bounds    zone visible d’une texture, par chemin (vide = image transparente)
   * @param variables valeurs des variables des textes
   */
  public static List<TitleToken> compose(final MenuDefinition menu, final ConditionContext context,
                                         final Function<String, Optional<ImageBounds>> bounds,
                                         final VariableResolver variables) {
    final List<TitleToken> tokens = new ArrayList<>();
    tokens.add(new TitleToken.Shift(-TITLE_X));
    int cursor = 0;

    for (final Layer layer : menu.layers()) {
      if (!layer.isVisible(context)) {
        continue;
      }
      final Optional<ImageBounds> measured = bounds.apply(layer.texture());
      if (measured.isEmpty()) {
        continue;
      }
      final GlyphMetrics metrics = GlyphMetrics.of(layer, measured.get());
      addShift(tokens, metrics.x() - cursor);
      tokens.add(new TitleToken.Glyph(layer.id(), metrics.ascent(), metrics.height(), metrics.advance()));
      cursor = metrics.x() + metrics.advance();
    }

    for (final TextElement text : menu.texts()) {
      if (!text.isVisible(context)) {
        continue;
      }
      final String value = Variables.interpolate(text.value(), variables);
      final int width = CharWidths.width(value);
      final int start;
      switch (text.align()) {
        case CENTER:
          start = text.x() - Math.floorDiv(width, 2);
          break;
        case RIGHT:
          start = text.x() - width;
          break;
        default:
          start = text.x();
          break;
      }
      addShift(tokens, start - cursor);
      tokens.add(new TitleToken.Text(value, TITLE_Y + 7 - text.y(), text.color()));
      cursor = start + width;
    }
    return tokens;
  }

  private static void addShift(final List<TitleToken> tokens, final int amount) {
    if (amount != 0) {
      tokens.add(new TitleToken.Shift(amount));
    }
  }
}

package dev.menuforge.render;

import dev.menuforge.image.ImageBounds;
import dev.menuforge.model.Layer;

/**
 * Métriques du glyphe d’une couche, dérivées de sa position et de la zone
 * visible de sa texture. Partagées par la composition du titre et la
 * génération de la police, pour qu’elles ne puissent pas diverger.
 *
 * @param x       abscisse fenêtre du premier pixel visible
 * @param top     ordonnée fenêtre du premier pixel visible
 * @param ascent  {@code 13 − top} ({@code TITLE_Y + 7 − top})
 * @param height  {@code max(hauteur visible, ascent)} : Minecraft exige {@code ascent ≤ height}
 * @param advance {@code largeur visible + 1}
 */
public record GlyphMetrics(int x, int top, int ascent, int height, int advance) {

  /** Calcule les métriques d’une couche dont la texture a pour zone visible {@code bounds}. */
  public static GlyphMetrics of(final Layer layer, final ImageBounds bounds) {
    final int x = layer.x() + bounds.cropX();
    final int top = layer.y() + bounds.cropY();
    final int ascent = TitleComposer.TITLE_Y + 7 - top;
    final int height = Math.max(bounds.height(), ascent);
    final int advance = bounds.width() + 1;
    return new GlyphMetrics(x, top, ascent, height, advance);
  }
}

package dev.menuforge.image;

import java.awt.image.BufferedImage;
import java.util.Optional;

/**
 * Mesure la zone réellement dessinée d’une image.
 *
 * <p>C’est ce que fait Minecraft pour calculer l’avance d’un glyphe bitmap : il
 * s’arrête à la dernière colonne contenant un pixel d’alpha non nul. En
 * recadrant l’image sur cette zone, l’avance devient simplement
 * {@code largeur + 1}.
 */
public final class ImageMeasurer {

  private ImageMeasurer() {
  }

  /** Boîte des pixels d’alpha &gt; 0, ou vide si l’image est entièrement transparente. */
  public static Optional<ImageBounds> measure(final BufferedImage image) {
    final int width = image.getWidth();
    final int height = image.getHeight();
    int minX = width;
    int minY = height;
    int maxX = -1;
    int maxY = -1;
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        if ((image.getRGB(x, y) >>> 24) != 0) {
          if (x < minX) {
            minX = x;
          }
          if (x > maxX) {
            maxX = x;
          }
          if (y < minY) {
            minY = y;
          }
          if (y > maxY) {
            maxY = y;
          }
        }
      }
    }
    if (maxX < 0) {
      return Optional.empty();
    }
    return Optional.of(new ImageBounds(minX, minY, maxX - minX + 1, maxY - minY + 1));
  }
}

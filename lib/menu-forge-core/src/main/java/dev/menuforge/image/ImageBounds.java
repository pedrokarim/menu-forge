package dev.menuforge.image;

/**
 * Boîte englobante des pixels visibles (alpha &gt; 0) d’une image.
 *
 * @param cropX  première colonne visible
 * @param cropY  première ligne visible
 * @param width  largeur de la zone visible
 * @param height hauteur de la zone visible
 */
public record ImageBounds(int cropX, int cropY, int width, int height) {

  public ImageBounds {
    if (cropX < 0 || cropY < 0 || width < 1 || height < 1) {
      throw new IllegalArgumentException("boîte englobante invalide : " + cropX + "," + cropY + " " + width + "x" + height);
    }
  }
}

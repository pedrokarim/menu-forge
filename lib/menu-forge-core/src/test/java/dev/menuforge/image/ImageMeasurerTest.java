package dev.menuforge.image;

import org.junit.jupiter.api.Test;

import java.awt.image.BufferedImage;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ImageMeasurerTest {

  /** Image transparente avec des pixels opaques aux coordonnées données. */
  static BufferedImage image(final int width, final int height, final int[]... pixels) {
    final BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    for (final int[] pixel : pixels) {
      image.setRGB(pixel[0], pixel[1], 0xFF336699);
    }
    return image;
  }

  @Test
  void measuresTheBoundingBoxOfVisiblePixels() {
    final BufferedImage image = image(20, 10, new int[]{3, 2}, new int[]{7, 5}, new int[]{5, 4});
    assertEquals(Optional.of(new ImageBounds(3, 2, 5, 4)), ImageMeasurer.measure(image));
  }

  @Test
  void countsAnyNonZeroAlpha() {
    final BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_ARGB);
    image.setRGB(6, 1, 0x01000000);
    assertEquals(Optional.of(new ImageBounds(6, 1, 1, 1)), ImageMeasurer.measure(image));
  }

  @Test
  void fullyTransparentImageIsEmpty() {
    assertTrue(ImageMeasurer.measure(new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB)).isEmpty());
  }

  @Test
  void opaqueImageWithoutAlphaChannelIsFullyVisible() {
    final BufferedImage image = new BufferedImage(4, 3, BufferedImage.TYPE_INT_RGB);
    assertEquals(Optional.of(new ImageBounds(0, 0, 4, 3)), ImageMeasurer.measure(image));
  }

  @Test
  void cropAndPadKeepsPixelsAndAddsTransparentRows() throws Exception {
    final BufferedImage image = image(20, 10, new int[]{3, 2}, new int[]{7, 5});
    final ImageBounds bounds = ImageMeasurer.measure(image).orElseThrow();
    final BufferedImage cropped = ImageOps.fromBytes(ImageOps.toPng(ImageOps.cropAndPad(image, bounds, 9)));
    assertEquals(5, cropped.getWidth());
    assertEquals(9, cropped.getHeight());
    assertEquals(0xFF336699, cropped.getRGB(0, 0));
    assertEquals(0xFF336699, cropped.getRGB(4, 3));
    assertEquals(0, cropped.getRGB(0, 8) >>> 24, "rangée ajoutée transparente");
    assertEquals(Optional.of(bounds.width()), ImageMeasurer.measure(cropped).map(ImageBounds::width));
  }
}

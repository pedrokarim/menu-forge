package dev.menuforge.image;

import dev.menuforge.MenuForgeException;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;

/** Opérations sur les images : recadrage, complément transparent, encodage PNG. */
public final class ImageOps {

  private ImageOps() {
  }

  /**
   * Recadre l’image sur {@code bounds} puis la complète en bas avec des pixels
   * transparents jusqu’à {@code targetHeight} (si elle est plus haute que la
   * zone). Les pixels sont copiés tels quels, alpha compris.
   */
  public static BufferedImage cropAndPad(final BufferedImage source, final ImageBounds bounds, final int targetHeight) {
    final int height = Math.max(bounds.height(), targetHeight);
    final BufferedImage result = new BufferedImage(bounds.width(), height, BufferedImage.TYPE_INT_ARGB);
    for (int y = 0; y < bounds.height(); y++) {
      for (int x = 0; x < bounds.width(); x++) {
        result.setRGB(x, y, source.getRGB(bounds.cropX() + x, bounds.cropY() + y));
      }
    }
    return result;
  }

  /** Encode une image en PNG. */
  public static byte[] toPng(final BufferedImage image) {
    try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      if (!ImageIO.write(image, "png", output)) {
        throw new MenuForgeException("aucun encodeur PNG disponible");
      }
      return output.toByteArray();
    } catch (final IOException exception) {
      throw new UncheckedIOException(exception);
    }
  }

  /** Décode un PNG (ou tout format lu par ImageIO). */
  public static BufferedImage fromBytes(final byte[] bytes) throws IOException {
    final BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
    if (image == null) {
      throw new IOException("format d’image non reconnu");
    }
    return image;
  }
}

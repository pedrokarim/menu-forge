package dev.menuforge.image;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Textures lues dans un dossier du disque. Refuse tout chemin qui sortirait du
 * dossier racine ({@code ../…}, chemin absolu).
 */
public final class DirectoryTextureSource implements TextureSource {

  private final Path root;

  public DirectoryTextureSource(final Path root) {
    this.root = root.toAbsolutePath().normalize();
  }

  @Override
  public BufferedImage load(final String path) throws IOException {
    final Path file = root.resolve(path).normalize();
    if (!file.startsWith(root)) {
      throw new IOException("chemin de texture hors du dossier des textures : " + path);
    }
    if (!Files.isRegularFile(file)) {
      return null;
    }
    final BufferedImage image = ImageIO.read(file.toFile());
    if (image == null) {
      throw new IOException("image illisible : " + file);
    }
    return image;
  }

  /** Dossier racine des textures. */
  public Path root() {
    return root;
  }
}

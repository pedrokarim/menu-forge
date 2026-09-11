package dev.menuforge.image;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.List;

/**
 * Plusieurs sources de textures interrogées dans l’ordre : la première qui
 * connaît le chemin l’emporte. Sert à charger plusieurs espaces de travail à la
 * fois (celui du plugin et ceux qu’un serveur consommateur ajoute).
 */
public final class CompositeTextureSource implements TextureSource {

  private final List<TextureSource> sources;

  public CompositeTextureSource(final List<? extends TextureSource> sources) {
    this.sources = List.copyOf(sources);
  }

  @Override
  public BufferedImage load(final String path) throws IOException {
    for (final TextureSource source : sources) {
      final BufferedImage image = source.load(path);
      if (image != null) {
        return image;
      }
    }
    return null;
  }
}

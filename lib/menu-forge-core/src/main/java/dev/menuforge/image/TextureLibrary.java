package dev.menuforge.image;

import dev.menuforge.MenuForgeException;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Cache des textures et de leurs mesures. Accepte aussi des images générées en
 * mémoire ({@link #register(String, BufferedImage)}), qui priment sur la source
 * (c’est ainsi qu’est fournie la couche de calibration).
 */
public final class TextureLibrary {

  private final TextureSource source;
  private final Map<String, BufferedImage> images = new ConcurrentHashMap<>();
  private final Map<String, Optional<ImageBounds>> bounds = new ConcurrentHashMap<>();

  public TextureLibrary(final TextureSource source) {
    this.source = source == null ? path -> null : source;
  }

  /** Bibliothèque sans source : seules les images enregistrées existent. */
  public static TextureLibrary inMemory() {
    return new TextureLibrary(null);
  }

  /** Enregistre (ou remplace) une image en mémoire. */
  public void register(final String path, final BufferedImage image) {
    images.put(path, image);
    bounds.remove(path);
  }

  /**
   * Image d’une texture.
   *
   * @throws MenuForgeException si la texture est introuvable ou illisible
   */
  public BufferedImage image(final String path) {
    final BufferedImage cached = images.get(path);
    if (cached != null) {
      return cached;
    }
    final BufferedImage loaded;
    try {
      loaded = source.load(path);
    } catch (final IOException exception) {
      throw new MenuForgeException("texture illisible « " + path + " » : " + exception.getMessage(), exception);
    }
    if (loaded == null) {
      throw new MenuForgeException("texture introuvable : « " + path + " »");
    }
    images.put(path, loaded);
    return loaded;
  }

  /** Mesure (mise en cache) d’une texture ; vide si entièrement transparente. */
  public Optional<ImageBounds> bounds(final String path) {
    final Optional<ImageBounds> cached = bounds.get(path);
    if (cached != null) {
      return cached;
    }
    final Optional<ImageBounds> measured = ImageMeasurer.measure(image(path));
    bounds.put(path, measured);
    return measured;
  }

  /** Vide le cache (les images enregistrées en mémoire sont oubliées aussi). */
  public void clear() {
    images.clear();
    bounds.clear();
  }
}

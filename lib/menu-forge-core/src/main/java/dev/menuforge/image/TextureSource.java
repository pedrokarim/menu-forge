package dev.menuforge.image;

import java.awt.image.BufferedImage;
import java.io.IOException;

/**
 * Fournit les images des couches à partir de leur chemin (relatif au dossier
 * {@code textures/} du projet, par exemple {@code badges/background.png}).
 */
@FunctionalInterface
public interface TextureSource {

  /**
   * Charge une image.
   *
   * @return l’image, ou {@code null} si elle n’existe pas
   * @throws IOException si elle existe mais ne peut pas être lue
   */
  BufferedImage load(String path) throws IOException;
}

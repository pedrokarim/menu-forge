package dev.menuforge.parse;

import dev.menuforge.MenuForgeException;

/**
 * Fichier {@code *.menu.json} invalide. Le message indique le fichier et le
 * chemin JSON de la clé fautive, par exemple
 * {@code badges.menu.json : $.layers[1].x : entier attendu}.
 */
public class MenuFormatException extends MenuForgeException {

  private final String source;
  private final String path;

  public MenuFormatException(final String source, final String path, final String message) {
    super(source + " : " + path + " : " + message);
    this.source = source;
    this.path = path;
  }

  public MenuFormatException(final String source, final String path, final String message, final Throwable cause) {
    super(source + " : " + path + " : " + message, cause);
    this.source = source;
    this.path = path;
  }

  /** Fichier (ou nom de source) en cause. */
  public String source() {
    return source;
  }

  /** Chemin JSON de la clé fautive ({@code $} = racine). */
  public String path() {
    return path;
  }
}

package dev.menuforge;

import dev.menuforge.model.MenuDefinition;
import dev.menuforge.parse.MenuParser;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

/** Outils partagés par les tests. */
public final class TestMenus {

  private TestMenus() {
  }

  /** Contenu d’une ressource de test. */
  public static String resource(final String path) {
    try (InputStream input = TestMenus.class.getResourceAsStream("/" + path)) {
      if (input == null) {
        throw new IllegalStateException("ressource absente : " + path);
      }
      return new String(input.readAllBytes(), StandardCharsets.UTF_8);
    } catch (final IOException exception) {
      throw new UncheckedIOException(exception);
    }
  }

  /** Lit un menu de {@code src/test/resources/menus}. */
  public static MenuDefinition menu(final String id) {
    return new MenuParser().parse(resource("menus/" + id + ".menu.json"), id + ".menu.json");
  }

  /** Lit un menu depuis du JSON en ligne. */
  public static MenuDefinition parse(final String json) {
    return new MenuParser().parse(json, "test.menu.json");
  }
}

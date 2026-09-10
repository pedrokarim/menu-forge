package dev.menuforge.pack;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;

/**
 * Écriture JSON des fichiers générés. Les caractères de la zone privée
 * ({@code U+E000}–{@code U+F8FF}) sont échappés en {@code \\uXXXX} : le fichier
 * reste lisible et identique d’une plateforme à l’autre.
 */
public final class JsonText {

  private static final Gson PRETTY = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
  private static final Gson COMPACT = new GsonBuilder().disableHtmlEscaping().create();

  private JsonText() {
  }

  /** JSON indenté (fichiers du pack). */
  public static String pretty(final JsonElement element) {
    return escapePrivateUse(PRETTY.toJson(element));
  }

  /** JSON compact (composants de titre). Les caractères ne sont pas échappés. */
  public static String compact(final JsonElement element) {
    return COMPACT.toJson(element);
  }

  private static String escapePrivateUse(final String json) {
    final StringBuilder builder = new StringBuilder(json.length());
    for (int i = 0; i < json.length(); i++) {
      final char c = json.charAt(i);
      if (c >= 0xE000 && c <= 0xF8FF) {
        builder.append(String.format("\\u%04x", (int) c));
      } else {
        builder.append(c);
      }
    }
    return builder.toString();
  }
}

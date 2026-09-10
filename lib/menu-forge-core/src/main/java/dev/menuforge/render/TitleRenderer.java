package dev.menuforge.render;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.menuforge.pack.JsonText;
import dev.menuforge.pack.PackGenerator;

import java.util.List;

/**
 * Transforme les jetons d’un titre en composant texte JSON (chaîne), à
 * désérialiser côté serveur (par exemple avec le {@code GsonComponentSerializer}
 * d’Adventure).
 *
 * <p>Les décalages et glyphes sont écrits dans la police du menu
 * ({@code <ns>:menus/<id>}), en blanc pour ne pas teinter les images ; chaque
 * texte est écrit dans sa police {@code <ns>:menus/text_<ascent>} avec sa
 * couleur (ou celle du titre, par défaut).
 */
public final class TitleRenderer {

  private static final String GLYPH_COLOR = "white";

  private final String namespace;

  /** Rendu dans l’espace de noms par défaut ({@code menuforge}). */
  public TitleRenderer() {
    this(PackGenerator.DEFAULT_NAMESPACE);
  }

  public TitleRenderer(final String namespace) {
    this.namespace = PackGenerator.checkNamespace(namespace);
  }

  /** Police d’un menu, par exemple {@code menuforge:menus/badges}. */
  public String menuFont(final String menuId) {
    return namespace + ":menus/" + menuId;
  }

  /** Police de texte d’un ascent, par exemple {@code menuforge:menus/text_m3}. */
  public String textFont(final int ascent) {
    return namespace + ":menus/" + textFontName(ascent);
  }

  /** Nom de fichier (sans extension) de la police de texte : {@code text_7}, {@code text_m3}… */
  public static String textFontName(final int ascent) {
    return ascent < 0 ? "text_m" + Math.abs((long) ascent) : "text_" + ascent;
  }

  /**
   * Composant JSON du titre.
   *
   * @param menuId id du menu (nom de sa police)
   * @param layout codepoints des couches du menu
   * @param tokens jetons produits par {@link TitleComposer}
   */
  public String render(final String menuId, final FontLayout layout, final List<TitleToken> tokens) {
    final JsonArray extra = new JsonArray();
    final StringBuilder pending = new StringBuilder();
    for (final TitleToken token : tokens) {
      if (token instanceof TitleToken.Shift shift) {
        pending.append(SpaceFont.encode(shift.amount()));
      } else if (token instanceof TitleToken.Glyph glyph) {
        pending.appendCodePoint(layout.codepoint(glyph.layerId()));
      } else if (token instanceof TitleToken.Text text) {
        flush(extra, pending, menuId);
        final JsonObject component = new JsonObject();
        component.addProperty("text", text.value());
        component.addProperty("font", textFont(text.ascent()));
        if (text.color() != null) {
          component.addProperty("color", text.color());
        }
        extra.add(component);
      }
    }
    flush(extra, pending, menuId);
    final JsonObject root = new JsonObject();
    root.addProperty("text", "");
    if (!extra.isEmpty()) {
      root.add("extra", extra);
    }
    return JsonText.compact(root);
  }

  private void flush(final JsonArray extra, final StringBuilder pending, final String menuId) {
    if (pending.length() == 0) {
      return;
    }
    final JsonObject component = new JsonObject();
    component.addProperty("text", pending.toString());
    component.addProperty("font", menuFont(menuId));
    component.addProperty("color", GLYPH_COLOR);
    extra.add(component);
    pending.setLength(0);
  }

  /** Espace de noms utilisé. */
  public String namespace() {
    return namespace;
  }
}

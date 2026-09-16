package dev.menuforge.pack;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.menuforge.text.CharWidths;
import dev.menuforge.text.VanillaFontData;

/**
 * Police des textes du titre : copie de la police vanilla à un {@code ascent}
 * donné.
 *
 * <p>Comme dans le jeu ({@code font/include/default.json}), les caractères sont
 * répartis sur trois planches, reprises telles quelles (grilles de
 * {@link VanillaFontData}, générées depuis le jar client) :
 * <ul>
 *   <li>{@code ascii.png} : l’ASCII et quelques signes (cases vides là où le jeu
 *   a retiré les accents) ;</li>
 *   <li>{@code accented.png} : lettres accentuées, glyphes de 12 px de haut dont
 *   les 3 premières rangées dépassent au-dessus de la ligne ; son ascent vanilla
 *   (10) vaut celui d’{@code ascii.png} (7) + 3, décalage conservé ici pour
 *   garder la même ligne de base ;</li>
 *   <li>{@code nonlatin_european.png} : grec, cyrillique, ponctuation
 *   typographique (’ « … »), même ascent que l’ASCII.</li>
 * </ul>
 * Les trois jeux de caractères sont disjoints : l’ordre des providers ne change
 * donc rien au caractère retenu (vanilla les liste dans l’ordre inverse).
 */
public final class AsciiFont {

  /** Texture de la planche ASCII. */
  public static final String FILE = "minecraft:font/ascii.png";
  /** Hauteur des glyphes ASCII (échelle 1). */
  public static final int HEIGHT = 8;
  /** Case vide (caractère nul, ignoré par Minecraft). */
  public static final String EMPTY = String.valueOf((char) 0);

  private AsciiFont() {
  }

  /**
   * Police de texte complète pour un ascent : un provider {@code space} pour
   * l’espace (sinon son avance serait calculée depuis la case de la grille),
   * puis les trois planches.
   */
  public static JsonObject font(final int ascent) {
    final JsonObject space = new JsonObject();
    space.addProperty("type", "space");
    final JsonObject advances = new JsonObject();
    advances.addProperty(" ", CharWidths.SPACE_ADVANCE);
    space.add("advances", advances);

    final JsonArray providers = new JsonArray();
    providers.add(space);
    for (final VanillaFontData.Sheet sheet : VanillaFontData.SHEETS) {
      final JsonObject bitmap = new JsonObject();
      bitmap.addProperty("type", "bitmap");
      bitmap.addProperty("file", sheet.file());
      bitmap.addProperty("ascent", ascent + sheet.ascentOffset());
      bitmap.addProperty("height", sheet.height());
      final JsonArray chars = new JsonArray();
      sheet.chars().forEach(chars::add);
      bitmap.add("chars", chars);
      providers.add(bitmap);
    }
    final JsonObject font = new JsonObject();
    font.add("providers", providers);
    return font;
  }
}

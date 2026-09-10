package dev.menuforge.pack;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.menuforge.text.CharWidths;

import java.util.List;

/**
 * Grille de caractères de {@code minecraft:font/ascii.png} (16 × 16 cases de
 * 8 px), telle que référencée par le {@code default.json} vanilla.
 *
 * <p><b>À vérifier en jeu.</b> Les lignes 2 à 7 (ASCII imprimable) sont
 * certaines. Les lignes 0–1 (capitales accentuées) et 8–15 (disposition de la
 * page de code 437 : lettres accentuées, cadres, grec, symboles) sont reprises
 * de mémoire : une erreur n’afficherait qu’un mauvais glyphe pour ces
 * caractères, sans casser la police. Le caractère nul ({@link #EMPTY}) marque
 * une case ignorée par Minecraft.
 */
public final class AsciiFont {

  /** Texture vanilla référencée. */
  public static final String FILE = "minecraft:font/ascii.png";
  /** Hauteur des glyphes (échelle 1). */
  public static final int HEIGHT = 8;
  /** Case vide (caractère nul, ignoré par Minecraft). */
  public static final String EMPTY = String.valueOf((char) 0);

  /** Les 16 lignes de 16 caractères. */
  public static final List<String> CHARS = List.of(
    "ÀÁÂÈÊËÍÓÔÕÚßãõğİ",
    "ıŒœŞşŴŵžȇ" + EMPTY.repeat(7),
    " !\"#$%&'()*+,-./",
    "0123456789:;<=>?",
    "@ABCDEFGHIJKLMNO",
    "PQRSTUVWXYZ[\\]^_",
    "`abcdefghijklmno",
    "pqrstuvwxyz{|}~" + EMPTY,
    "ÇüéâäàåçêëèïîìÄÅ",
    "ÉæÆôöòûùÿÖÜø£Ø×ƒ",
    "áíóúñÑªº¿®¬½¼¡«»",
    "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐",
    "└┴┬├─┼╞╟╚╔╩╦╠═╬╧",
    "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀",
    "αβΓπΣσμτΦΘΩδ∞∅∈∩",
    "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■" + EMPTY
  );

  static {
    if (CHARS.size() != 16) {
      throw new IllegalStateException("la grille ASCII doit avoir 16 lignes");
    }
    for (final String row : CHARS) {
      if (row.codePointCount(0, row.length()) != 16) {
        throw new IllegalStateException("ligne de la grille ASCII de longueur incorrecte : " + row);
      }
    }
  }

  private AsciiFont() {
  }

  /**
   * Police de texte complète pour un ascent : un provider {@code space} pour
   * l’espace (sinon son avance serait calculée depuis une case vide), puis la
   * grille bitmap.
   */
  public static JsonObject font(final int ascent) {
    final JsonObject space = new JsonObject();
    space.addProperty("type", "space");
    final JsonObject advances = new JsonObject();
    advances.addProperty(" ", CharWidths.SPACE_ADVANCE);
    space.add("advances", advances);

    final JsonObject bitmap = new JsonObject();
    bitmap.addProperty("type", "bitmap");
    bitmap.addProperty("file", FILE);
    bitmap.addProperty("ascent", ascent);
    bitmap.addProperty("height", HEIGHT);
    final JsonArray chars = new JsonArray();
    CHARS.forEach(chars::add);
    bitmap.add("chars", chars);

    final JsonArray providers = new JsonArray();
    providers.add(space);
    providers.add(bitmap);
    final JsonObject font = new JsonObject();
    font.add("providers", providers);
    return font;
  }
}

package dev.menuforge.pack;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.menuforge.TestMenus;
import dev.menuforge.calibration.CalibrationMenu;
import dev.menuforge.image.ImageOps;
import dev.menuforge.image.TextureLibrary;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.parse.MenuValidator;
import dev.menuforge.render.CompiledMenu;
import dev.menuforge.render.SpaceFont;
import dev.menuforge.render.TitleRenderer;
import dev.menuforge.state.ConditionContext;
import dev.menuforge.text.VariableResolver;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PackGeneratorTest {

  /** Chaîne d’un seul codepoint (évite les caractères privés en clair dans le source). */
  private static String cp(final int codepoint) {
    return new String(Character.toChars(codepoint));
  }

  private static BufferedImage block(final int width, final int height, final int offsetX, final int offsetY,
                                     final int visibleWidth, final int visibleHeight) {
    final BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    for (int y = offsetY; y < offsetY + visibleHeight; y++) {
      for (int x = offsetX; x < offsetX + visibleWidth; x++) {
        image.setRGB(x, y, 0xFFAA0000);
      }
    }
    return image;
  }

  private static TextureLibrary textures() {
    final TextureLibrary textures = TextureLibrary.inMemory();
    textures.register("bg.png", block(176, 200, 0, 2, 176, 100));
    textures.register("empty.png", new BufferedImage(8, 8, BufferedImage.TYPE_INT_ARGB));
    textures.register("icon.png", block(16, 16, 2, 0, 8, 6));
    return textures;
  }

  private static final String MENU = """
    { "id": "shop",
      "layers": [
        { "id": "bg", "texture": "bg.png", "x": 0, "y": 31 },
        { "id": "ghost", "texture": "empty.png", "x": 0, "y": 0 },
        { "id": "Icon Top", "texture": "icon.png", "x": 20, "y": 1 }
      ],
      "texts": [
        { "id": "a", "x": 88, "y": 16, "value": "x" },
        { "id": "b", "x": 88, "y": 6, "value": "y" }
      ] }
    """;

  @Test
  void generatesMenuFontWithPrivateUseCodepoints() {
    final GeneratedPack pack = new PackGenerator().generate(TestMenus.parse(MENU), textures());

    final String fontText = pack.text("assets/menuforge/font/menus/shop.json");
    final JsonArray providers = JsonParser.parseString(fontText).getAsJsonObject().getAsJsonArray("providers");
    assertEquals(3, providers.size(), "space + 2 couches non vides");

    final JsonObject space = providers.get(0).getAsJsonObject();
    assertEquals("space", space.get("type").getAsString());
    final JsonObject advances = space.getAsJsonObject("advances");
    assertEquals(22, advances.size());
    assertEquals(-1, advances.get(cp(0xF801)).getAsInt());
    assertEquals(-1024, advances.get(cp(0xF80B)).getAsInt());
    assertEquals(1, advances.get(cp(0xF821)).getAsInt());
    assertEquals(1024, advances.get(cp(0xF82B)).getAsInt());

    final JsonObject background = providers.get(1).getAsJsonObject();
    assertEquals("bitmap", background.get("type").getAsString());
    assertEquals("menuforge:menus/shop/bg.png", background.get("file").getAsString());
    assertEquals(13 - 33, background.get("ascent").getAsInt());
    assertEquals(100, background.get("height").getAsInt());
    assertEquals(cp(0xE000), background.getAsJsonArray("chars").get(0).getAsString());

    // La couche vide ne consomme pas de codepoint : l’icône reçoit U+E001.
    final JsonObject icon = providers.get(2).getAsJsonObject();
    assertEquals(cp(0xE001), icon.getAsJsonArray("chars").get(0).getAsString());
    assertEquals("menuforge:menus/shop/icon_top.png", icon.get("file").getAsString());
    assertEquals(12, icon.get("ascent").getAsInt());
    assertEquals(12, icon.get("height").getAsInt(), "ascent 12 > hauteur visible 6");

    // Les codepoints privés sont échappés dans le fichier.
    assertTrue(fontText.contains("\\ue000"), fontText);
    assertFalse(fontText.contains(cp(0xE000)));
  }

  @Test
  void writesCroppedAndPaddedTextures() throws Exception {
    final GeneratedPack pack = new PackGenerator().generate(TestMenus.parse(MENU), textures());

    final BufferedImage background = ImageOps.fromBytes(pack.file("assets/menuforge/textures/menus/shop/bg.png"));
    assertEquals(176, background.getWidth());
    assertEquals(100, background.getHeight());

    final BufferedImage icon = ImageOps.fromBytes(pack.file("assets/menuforge/textures/menus/shop/icon_top.png"));
    assertEquals(8, icon.getWidth());
    assertEquals(12, icon.getHeight(), "complétée en bas jusqu’à height");
    assertEquals(0xFFAA0000, icon.getRGB(0, 0));
    assertEquals(0, icon.getRGB(0, 11) >>> 24);
    assertNull(pack.file("assets/menuforge/textures/menus/shop/ghost.png"));
  }

  @Test
  void generatesOneTextFontPerAscent() {
    final GeneratedPack pack = new PackGenerator("custom_ns").generate(TestMenus.parse(MENU), textures());

    assertNotNull(pack.file("assets/custom_ns/font/menus/text_m3.json"));
    assertNotNull(pack.file("assets/custom_ns/font/menus/text_7.json"));
    final JsonObject font = JsonParser.parseString(pack.text("assets/custom_ns/font/menus/text_m3.json")).getAsJsonObject();
    final JsonArray providers = font.getAsJsonArray("providers");
    assertEquals(4, providers.get(0).getAsJsonObject().getAsJsonObject("advances").get(" ").getAsInt());
    final JsonObject ascii = providers.get(1).getAsJsonObject();
    assertEquals("minecraft:font/ascii.png", ascii.get("file").getAsString());
    assertEquals(-3, ascii.get("ascent").getAsInt());
    assertEquals(8, ascii.get("height").getAsInt());
    final JsonArray chars = ascii.getAsJsonArray("chars");
    assertEquals(16, chars.size());
    assertEquals("0123456789:;<=>?", chars.get(3).getAsString());
    for (int row = 0; row < 16; row++) {
      final String line = chars.get(row).getAsString();
      assertEquals(16, line.codePointCount(0, line.length()), "ligne " + row);
    }
  }

  @Test
  void titleJsonUsesMenuAndTextFonts() {
    final CompiledMenu compiled = CompiledMenu.compile(TestMenus.parse(MENU), textures());
    final String json = compiled.titleJson(new TitleRenderer(), ConditionContext.EMPTY, VariableResolver.NONE);

    final JsonObject root = JsonParser.parseString(json).getAsJsonObject();
    assertEquals("", root.get("text").getAsString());
    final JsonArray extra = root.getAsJsonArray("extra");
    // glyphes + décalage ; texte « x » ; décalage (police du menu) ; texte « y ».
    assertEquals(4, extra.size());
    assertEquals("menuforge:menus/shop", extra.get(2).getAsJsonObject().get("font").getAsString());
    assertEquals("menuforge:menus/text_7", extra.get(3).getAsJsonObject().get("font").getAsString());

    final JsonObject glyphs = extra.get(0).getAsJsonObject();
    assertEquals("menuforge:menus/shop", glyphs.get("font").getAsString());
    assertEquals("white", glyphs.get("color").getAsString());
    // −8 ; glyphe bg (x 0, avance 177) ; décalage 22 − 177 ; glyphe icône (avance 9) ; décalage vers le texte « x ».
    final String expected = SpaceFont.encode(-8) + cp(0xE000) + SpaceFont.encode(22 - 177) + cp(0xE001)
      + SpaceFont.encode(88 - (22 + 9));
    assertEquals(expected, glyphs.get("text").getAsString());

    final JsonObject firstText = extra.get(1).getAsJsonObject();
    assertEquals("x", firstText.get("text").getAsString());
    assertEquals("menuforge:menus/text_m3", firstText.get("font").getAsString());
    assertFalse(firstText.has("color"));
  }

  @Test
  void spaceFontEncodesAnyShift() {
    for (final int shift : new int[]{-5000, -2049, -1024, -177, -8, -1, 1, 7, 156, 1023, 2048, 3000}) {
      assertEquals(shift, SpaceFont.advanceOf(SpaceFont.encode(shift)), "décalage " + shift);
    }
    assertEquals("", SpaceFont.encode(0));
    assertEquals(cp(0xF804), SpaceFont.encode(-8));
    assertEquals(cp(0xF802) + cp(0xF801), SpaceFont.encode(-3));
    assertEquals(cp(0xF82B) + cp(0xF82B) + cp(0xF821), SpaceFont.encode(2049));
  }

  @Test
  void calibrationMenuIsValidAndGenerates(@TempDir final Path directory) throws Exception {
    final TextureLibrary textures = TextureLibrary.inMemory();
    final MenuDefinition calibration = CalibrationMenu.register(textures, 6);
    assertEquals(List.of(), MenuValidator.problems(calibration));

    final GeneratedPack pack = new PackGenerator().generate(calibration, textures)
      .merge(PackGenerator.packMeta(46, "test"));
    final BufferedImage grid = ImageOps.fromBytes(
      pack.file("assets/menuforge/textures/menus/" + CalibrationMenu.MENU_ID + "/grid.png"));
    assertEquals(176, grid.getWidth());
    assertEquals(222, grid.getHeight());

    PackWriter.writeDirectory(pack, directory);
    assertTrue(Files.isRegularFile(directory.resolve("pack.mcmeta")));
    assertTrue(Files.isRegularFile(directory.resolve("assets/menuforge/font/menus/" + CalibrationMenu.MENU_ID + ".json")));
    PackWriter.writeZip(pack, directory.resolve("out/pack.zip"));
    assertTrue(Files.size(directory.resolve("out/pack.zip")) > 0);
  }
}

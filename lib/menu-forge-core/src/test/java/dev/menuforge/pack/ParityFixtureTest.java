package dev.menuforge.pack;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.menuforge.image.DirectoryTextureSource;
import dev.menuforge.image.ImageOps;
import dev.menuforge.image.TextureLibrary;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.parse.MenuParser;
import dev.menuforge.render.CompiledMenu;
import dev.menuforge.render.TitleRenderer;
import dev.menuforge.render.TitleToken;
import dev.menuforge.state.ConditionContext;
import dev.menuforge.state.StateSnapshot;
import dev.menuforge.template.TemplateResolver;
import dev.menuforge.text.VariableResolver;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Fixture de parité partagée avec le studio : les menus et textures de
 * {@code src/test/resources/parity} doivent produire exactement les fichiers
 * de {@code parity/expected} (polices et titres octet pour octet, PNG pixel
 * pour pixel). Le studio vérifie la même fixture avec son propre générateur
 * ({@code studio/tests/parity.test.ts}) : si les deux passent, Java et
 * TypeScript produisent le même pack.
 *
 * <p>Régénérer après un changement voulu de l’algorithme :
 * {@code ./gradlew :menu-forge-core:test --tests '*ParityFixtureTest' -PparityUpdate=true},
 * puis relancer le test du studio.
 */
class ParityFixtureTest {

  private static final Path DIR = Path.of(System.getProperty("menuforge.parity.dir", "src/test/resources/parity"));
  private static final boolean UPDATE = Boolean.getBoolean("menuforge.parity.update");
  private static final String NAMESPACE = "menuforge";

  @Test
  void javaOutputMatchesTheSharedFixture() throws IOException {
    if (UPDATE) {
      FixtureTextures.write(DIR.resolve("textures"));
    }
    final List<MenuDefinition> menus = resolvedMenus();
    final TextureLibrary textures = new TextureLibrary(new DirectoryTextureSource(DIR.resolve("textures")));

    final Map<String, byte[]> produced = new TreeMap<>();
    new PackGenerator(NAMESPACE).generate(menus, textures).files()
      .forEach((path, bytes) -> produced.put("pack/" + path, bytes));
    produced.put("titles.json", (JsonText.pretty(titles(menus, textures)) + "\n").getBytes(StandardCharsets.UTF_8));

    final Path expected = DIR.resolve("expected");
    if (UPDATE) {
      rewrite(expected, produced);
      return;
    }
    final Set<String> expectedFiles = listFiles(expected);
    assertEquals(expectedFiles, produced.keySet(), "liste des fichiers produits");
    for (final Map.Entry<String, byte[]> entry : produced.entrySet()) {
      final byte[] wanted = Files.readAllBytes(expected.resolve(entry.getKey()));
      if (entry.getKey().endsWith(".png")) {
        assertSamePixels(entry.getKey(), wanted, entry.getValue());
      } else {
        assertEquals(new String(wanted, StandardCharsets.UTF_8), new String(entry.getValue(), StandardCharsets.UTF_8),
          entry.getKey());
      }
    }
  }

  /** Menus de la fixture, gabarits résolus (gabarits eux-mêmes exclus), triés par id. */
  static List<MenuDefinition> resolvedMenus() throws IOException {
    final Map<String, MenuDefinition> all = new LinkedHashMap<>();
    final MenuParser parser = new MenuParser();
    try (Stream<Path> files = Files.list(DIR.resolve("menus"))) {
      for (final Path file : files.sorted().collect(Collectors.toList())) {
        final MenuDefinition menu = parser.parse(file);
        all.put(menu.id(), menu);
      }
    }
    final TemplateResolver resolver = new TemplateResolver(all::get);
    final List<MenuDefinition> resolved = new ArrayList<>();
    for (final MenuDefinition menu : all.values()) {
      if (!menu.template()) {
        resolved.add(resolver.resolve(menu));
      }
    }
    resolved.sort(Comparator.comparing(MenuDefinition::id));
    return resolved;
  }

  /**
   * Jetons et composant JSON du titre de chaque menu, dans son état initial,
   * sans drapeau, avec {@code viewer.name = Steve}.
   */
  private static JsonObject titles(final List<MenuDefinition> menus, final TextureLibrary textures) {
    final JsonObject titles = new JsonObject();
    final TitleRenderer renderer = new TitleRenderer(NAMESPACE);
    for (final MenuDefinition menu : menus) {
      final CompiledMenu compiled = CompiledMenu.compile(menu, textures);
      final StateSnapshot snapshot = StateSnapshot.of(menu.state(), Map.of(), Map.of());
      final ConditionContext context = snapshot.context(Set.of());
      final VariableResolver variables = snapshot.asResolver().or(name -> "viewer.name".equals(name) ? "Steve" : null);

      final JsonArray tokens = new JsonArray();
      for (final TitleToken token : compiled.tokens(context, variables)) {
        final JsonObject json = new JsonObject();
        if (token instanceof TitleToken.Shift shift) {
          json.addProperty("kind", "shift");
          json.addProperty("amount", shift.amount());
        } else if (token instanceof TitleToken.Glyph glyph) {
          json.addProperty("kind", "glyph");
          json.addProperty("layerId", glyph.layerId());
          json.addProperty("ascent", glyph.ascent());
          json.addProperty("height", glyph.height());
          json.addProperty("advance", glyph.advance());
        } else if (token instanceof TitleToken.Text text) {
          json.addProperty("kind", "text");
          json.addProperty("value", text.value());
          json.addProperty("ascent", text.ascent());
          if (text.color() != null) {
            json.addProperty("color", text.color());
          }
        }
        tokens.add(json);
      }
      final JsonObject entry = new JsonObject();
      entry.add("tokens", tokens);
      entry.addProperty("json", compiled.titleJson(renderer, context, variables));
      titles.add(menu.id(), entry);
    }
    return titles;
  }

  private static void assertSamePixels(final String path, final byte[] expected, final byte[] actual) throws IOException {
    final BufferedImage wanted = ImageOps.fromBytes(expected);
    final BufferedImage got = ImageOps.fromBytes(actual);
    assertEquals(wanted.getWidth(), got.getWidth(), path + " : largeur");
    assertEquals(wanted.getHeight(), got.getHeight(), path + " : hauteur");
    for (int y = 0; y < wanted.getHeight(); y++) {
      for (int x = 0; x < wanted.getWidth(); x++) {
        if (wanted.getRGB(x, y) != got.getRGB(x, y)) {
          fail(path + " : pixel (" + x + ", " + y + ") différent");
        }
      }
    }
  }

  private static Set<String> listFiles(final Path root) throws IOException {
    assertTrue(Files.isDirectory(root), "fixture absente : lancer une fois avec -PparityUpdate=true");
    try (Stream<Path> files = Files.walk(root)) {
      return files.filter(Files::isRegularFile)
        .map(file -> root.relativize(file).toString().replace('\\', '/'))
        .collect(Collectors.toCollection(java.util.TreeSet::new));
    }
  }

  /** Remplace le contenu de {@code expected/} (et lui seul) par les fichiers produits. */
  private static void rewrite(final Path expected, final Map<String, byte[]> produced) throws IOException {
    if (Files.exists(expected)) {
      try (Stream<Path> files = Files.walk(expected)) {
        for (final Path file : files.sorted(Comparator.reverseOrder()).collect(Collectors.toList())) {
          Files.delete(file);
        }
      }
    }
    for (final Map.Entry<String, byte[]> entry : produced.entrySet()) {
      final Path file = expected.resolve(entry.getKey());
      Files.createDirectories(file.getParent());
      Files.write(file, entry.getValue());
    }
  }

  /** Textures de la fixture, dessinées par code (aucun asset tiers). */
  static final class FixtureTextures {

    private FixtureTextures() {
    }

    static void write(final Path root) throws IOException {
      final Path parity = root.resolve("parity");
      Files.createDirectories(parity);
      save(parity.resolve("bar.png"), bar());
      save(parity.resolve("panel.png"), panel());
      save(parity.resolve("icon.png"), icon());
      save(parity.resolve("veil.png"), fill(176, 222, 0x80000000));
      save(parity.resolve("empty.png"), fill(16, 16, 0x00000000));
    }

    /** Barre 176 × 20 opaque, dégradé horizontal. */
    private static BufferedImage bar() {
      final BufferedImage image = new BufferedImage(176, 20, BufferedImage.TYPE_INT_ARGB);
      for (int y = 0; y < 20; y++) {
        for (int x = 0; x < 176; x++) {
          final int shade = 0x40 + x / 2;
          image.setRGB(x, y, 0xFF000000 | shade << 16 | shade << 8 | 0x60);
        }
      }
      return image;
    }

    /** Panneau biseauté 172 × 88 posé en (2, 3) sur une toile 180 × 96 (marges transparentes). */
    private static BufferedImage panel() {
      final BufferedImage image = new BufferedImage(180, 96, BufferedImage.TYPE_INT_ARGB);
      for (int y = 3; y < 91; y++) {
        for (int x = 2; x < 174; x++) {
          final boolean light = x == 2 || y == 3;
          final boolean dark = x == 173 || y == 90;
          image.setRGB(x, y, light ? 0xFFFFFFFF : dark ? 0xFF555555 : 0xFFC6C6C6);
        }
      }
      return image;
    }

    /** Icône 16 × 16 : disque opaque, halo semi-transparent, coins vides. */
    private static BufferedImage icon() {
      final BufferedImage image = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
      for (int y = 0; y < 16; y++) {
        for (int x = 0; x < 16; x++) {
          final double distance = Math.hypot(x - 7.5, y - 7.5);
          if (distance < 5) {
            image.setRGB(x, y, 0xFFD03020);
          } else if (distance < 7) {
            image.setRGB(x, y, 0x7FD03020);
          }
        }
      }
      return image;
    }

    private static BufferedImage fill(final int width, final int height, final int argb) {
      final BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
      for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
          image.setRGB(x, y, argb);
        }
      }
      return image;
    }

    private static void save(final Path file, final BufferedImage image) throws IOException {
      ImageIO.write(image, "png", file.toFile());
    }
  }
}

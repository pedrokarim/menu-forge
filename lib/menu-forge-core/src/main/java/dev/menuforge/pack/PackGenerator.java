package dev.menuforge.pack;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.menuforge.image.ImageBounds;
import dev.menuforge.image.ImageOps;
import dev.menuforge.image.TextureLibrary;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.TextElement;
import dev.menuforge.render.FontLayout;
import dev.menuforge.render.GlyphMetrics;
import dev.menuforge.render.SpaceFont;
import dev.menuforge.render.TitleComposer;
import dev.menuforge.render.TitleRenderer;

import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * Génère les fichiers de resource pack d’un ensemble de menus résolus.
 *
 * <p>Pour chaque menu {@code <id>} :
 * <ul>
 *   <li>{@code assets/<ns>/font/menus/<id>.json} : un provider {@code space}
 *       (décalages, voir {@link SpaceFont}) puis un provider {@code bitmap} par
 *       couche non vide, codepoint attribué par {@link FontLayout} ;</li>
 *   <li>{@code assets/<ns>/textures/menus/<id>/<couche>.png} : la texture
 *       recadrée, complétée en bas par du transparent si
 *       {@code height > hauteur visible}.</li>
 * </ul>
 * Et, pour chaque ascent de texte utilisé par l’un des menus,
 * {@code assets/<ns>/font/menus/text_<ascent>.json} ({@code text_m<abs>} pour
 * un ascent négatif), copie de la police ASCII vanilla avec cet ascent.
 */
public final class PackGenerator {

  /** Espace de noms par défaut. */
  public static final String DEFAULT_NAMESPACE = "menuforge";
  private static final Pattern NAMESPACE = Pattern.compile("[a-z0-9_.\\-]+");
  private static final Pattern UNSAFE_PATH_CHARS = Pattern.compile("[^a-z0-9_.\\-]");

  private final String namespace;

  public PackGenerator() {
    this(DEFAULT_NAMESPACE);
  }

  public PackGenerator(final String namespace) {
    this.namespace = checkNamespace(namespace);
  }

  /** Vérifie un espace de noms de resource pack. */
  public static String checkNamespace(final String namespace) {
    if (namespace == null || !NAMESPACE.matcher(namespace).matches()) {
      throw new IllegalArgumentException("espace de noms invalide « " + namespace + " » (attendu : [a-z0-9_.-]+)");
    }
    return namespace;
  }

  /** Génère le pack d’un seul menu résolu (polices de texte comprises). */
  public GeneratedPack generate(final MenuDefinition menu, final TextureLibrary textures) {
    return generate(List.of(menu), textures);
  }

  /**
   * Génère le pack de plusieurs menus résolus. Les gabarits ({@code template: true})
   * sont ignorés : ils n’ont pas de police propre.
   *
   * @throws dev.menuforge.MenuForgeException si une texture est introuvable ou illisible
   */
  public GeneratedPack generate(final Collection<MenuDefinition> menus, final TextureLibrary textures) {
    final Map<String, byte[]> files = new TreeMap<>();
    final Set<Integer> textAscents = new TreeSet<>();
    for (final MenuDefinition menu : menus) {
      if (menu.template()) {
        continue;
      }
      generateMenu(menu, textures, files);
      for (final TextElement text : menu.texts()) {
        textAscents.add(TitleComposer.TITLE_Y + 7 - text.y());
      }
    }
    for (final int ascent : textAscents) {
      files.put(fontPath(TitleRenderer.textFontName(ascent)), utf8(JsonText.pretty(AsciiFont.font(ascent))));
    }
    return new GeneratedPack(files);
  }

  private void generateMenu(final MenuDefinition menu, final TextureLibrary textures, final Map<String, byte[]> files) {
    final FontLayout layout = FontLayout.of(menu, textures::bounds);
    final JsonArray providers = new JsonArray();
    providers.add(spaceProvider());

    final Set<String> usedFileNames = new HashSet<>();
    for (final Layer layer : menu.layers()) {
      final Optional<ImageBounds> measured = textures.bounds(layer.texture());
      if (measured.isEmpty() || !layout.codepoints().containsKey(layer.id())) {
        continue;
      }
      final int codepoint = layout.codepoint(layer.id());
      final ImageBounds bounds = measured.get();
      final GlyphMetrics metrics = GlyphMetrics.of(layer, bounds);

      String fileName = UNSAFE_PATH_CHARS.matcher(layer.id().toLowerCase(Locale.ROOT)).replaceAll("_");
      if (!usedFileNames.add(fileName)) {
        fileName = fileName + "_" + Integer.toHexString(codepoint);
        usedFileNames.add(fileName);
      }
      final String textureRelative = "menus/" + menu.id() + "/" + fileName + ".png";
      files.put("assets/" + namespace + "/textures/" + textureRelative,
        ImageOps.toPng(ImageOps.cropAndPad(textures.image(layer.texture()), bounds, metrics.height())));

      final JsonObject bitmap = new JsonObject();
      bitmap.addProperty("type", "bitmap");
      bitmap.addProperty("file", namespace + ":" + textureRelative);
      bitmap.addProperty("ascent", metrics.ascent());
      bitmap.addProperty("height", metrics.height());
      final JsonArray chars = new JsonArray();
      chars.add(new String(Character.toChars(codepoint)));
      bitmap.add("chars", chars);
      providers.add(bitmap);
    }

    final JsonObject font = new JsonObject();
    font.add("providers", providers);
    files.put(fontPath(menu.id()), utf8(JsonText.pretty(font)));
  }

  private static JsonObject spaceProvider() {
    final JsonObject space = new JsonObject();
    space.addProperty("type", "space");
    final JsonObject advances = new JsonObject();
    SpaceFont.advances().forEach(advances::addProperty);
    space.add("advances", advances);
    return space;
  }

  /** Chemin d’une police {@code menus/<name>} dans le pack. */
  public String fontPath(final String name) {
    return "assets/" + namespace + "/font/menus/" + name + ".json";
  }

  /** Espace de noms utilisé. */
  public String namespace() {
    return namespace;
  }

  /**
   * Un {@code pack.mcmeta} minimal, pour utiliser le dossier généré comme pack
   * autonome (à fusionner sinon dans le pack du serveur).
   */
  public static GeneratedPack packMeta(final int packFormat, final String description) {
    final JsonObject pack = new JsonObject();
    pack.addProperty("pack_format", packFormat);
    pack.addProperty("description", description);
    final JsonObject root = new JsonObject();
    root.add("pack", pack);
    return new GeneratedPack(Map.of("pack.mcmeta", utf8(JsonText.pretty(root))));
  }

  private static byte[] utf8(final String text) {
    return text.getBytes(StandardCharsets.UTF_8);
  }
}

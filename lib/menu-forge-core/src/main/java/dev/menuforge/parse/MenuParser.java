package dev.menuforge.parse;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import dev.menuforge.model.Action;
import dev.menuforge.model.Condition;
import dev.menuforge.model.ContainerSpec;
import dev.menuforge.model.ItemSpec;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.Slot;
import dev.menuforge.model.SlotArea;
import dev.menuforge.model.SlotKind;
import dev.menuforge.model.StateDefinition;
import dev.menuforge.model.TextAlign;
import dev.menuforge.model.TextElement;

import java.io.IOException;
import java.io.Reader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BiFunction;
import java.util.regex.Pattern;

/**
 * Lit un fichier {@code *.menu.json} (version 1) et produit un
 * {@link MenuDefinition}.
 *
 * <p>Politique : les clés inconnues sont ignorées (compatibilité ascendante ;
 * c’est le cas de {@code generator}, métadonnée du studio sur les couches), mais
 * toute clé connue au mauvais type, toute clé obligatoire absente et toute
 * valeur hors domaine lève une {@link MenuFormatException} qui nomme le chemin
 * de la clé fautive.
 */
public final class MenuParser {

  /** Format des identifiants de menu. */
  public static final Pattern MENU_ID = Pattern.compile("[a-z0-9_]+");
  /** Format d’une couleur hexadécimale. */
  public static final Pattern HEX_COLOR = Pattern.compile("#[0-9a-fA-F]{6}");

  /** Lit un menu depuis une chaîne JSON ; {@code source} sert aux messages d’erreur. */
  public MenuDefinition parse(final String json, final String source) {
    final JsonElement root;
    try {
      root = JsonParser.parseString(json);
    } catch (final JsonParseException exception) {
      throw new MenuFormatException(source, "$", "JSON invalide : " + rootMessage(exception), exception);
    }
    return new Session(source).menu(root);
  }

  /** Lit un menu depuis un flux. */
  public MenuDefinition parse(final Reader reader, final String source) {
    final JsonElement root;
    try {
      root = JsonParser.parseReader(reader);
    } catch (final JsonParseException exception) {
      throw new MenuFormatException(source, "$", "JSON invalide : " + rootMessage(exception), exception);
    }
    return new Session(source).menu(root);
  }

  /** Lit un menu depuis un fichier (UTF-8). */
  public MenuDefinition parse(final Path file) throws IOException {
    return parse(Files.readString(file, StandardCharsets.UTF_8), file.getFileName().toString());
  }

  private static String rootMessage(final Throwable throwable) {
    Throwable current = throwable;
    while (current.getCause() != null && current.getCause() != current) {
      current = current.getCause();
    }
    return current.getMessage();
  }

  /** État d’une lecture : le nom de la source, pour les messages. */
  private static final class Session {

    private final String source;

    private Session(final String source) {
      this.source = source;
    }

    // --- Racine ---------------------------------------------------------------

    private MenuDefinition menu(final JsonElement element) {
      final String path = "$";
      final JsonObject root = object(element, path);
      final int formatVersion = optionalInt(root, "formatVersion", path, MenuDefinition.FORMAT_VERSION);
      if (formatVersion != MenuDefinition.FORMAT_VERSION) {
        throw error(path + ".formatVersion", "version de format non prise en charge : " + formatVersion
          + " (attendu : " + MenuDefinition.FORMAT_VERSION + ")");
      }
      final String id = requiredString(root, "id", path);
      if (!MENU_ID.matcher(id).matches()) {
        throw error(path + ".id", "identifiant invalide « " + id + " » (attendu : [a-z0-9_]+)");
      }
      final String name = optionalString(root, "name", path, id);
      final boolean template = optionalBoolean(root, "template", path, false);
      final List<String> parents = stringList(root, "extends", path);
      final ContainerSpec container = root.has("container") ? container(root.get("container"), path + ".container") : null;
      final Map<String, StateDefinition> state = root.has("state") ? state(root.get("state"), path + ".state") : Map.of();
      final List<Layer> layers = list(root, "layers", path, this::layer);
      final List<TextElement> texts = list(root, "texts", path, this::text);
      final List<Slot> slots = list(root, "slots", path, this::slot);
      return new MenuDefinition(formatVersion, id, name, template, parents, container, state, layers, texts, slots);
    }

    private ContainerSpec container(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      final String type = optionalString(object, "type", path, ContainerSpec.CHEST);
      if (!ContainerSpec.CHEST.equals(type)) {
        throw error(path + ".type", "type de conteneur non pris en charge : « " + type + " » (seul « chest » existe)");
      }
      final int rows = requiredInt(object, "rows", path);
      if (rows < 1 || rows > 6) {
        throw error(path + ".rows", "un coffre a de 1 à 6 lignes (reçu : " + rows + ")");
      }
      return ContainerSpec.chest(rows);
    }

    // --- État -----------------------------------------------------------------

    private Map<String, StateDefinition> state(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      final Map<String, StateDefinition> state = new LinkedHashMap<>();
      for (final Map.Entry<String, JsonElement> entry : object.entrySet()) {
        state.put(entry.getKey(), stateDefinition(entry.getValue(), path + "." + entry.getKey()));
      }
      return state;
    }

    private StateDefinition stateDefinition(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      final String type = requiredString(object, "type", path);
      switch (type) {
        case "enum": {
          final List<String> values = stringList(object, "values", path);
          if (values.isEmpty()) {
            throw error(path + ".values", "un état enum doit lister au moins une valeur");
          }
          final String defaultValue = requiredString(object, "default", path);
          if (!values.contains(defaultValue)) {
            throw error(path + ".default", "« " + defaultValue + " » n’est pas dans values " + values);
          }
          return new StateDefinition.EnumState(values, defaultValue);
        }
        case "bool":
          if (!object.has("default")) {
            throw error(path + ".default", "clé obligatoire absente");
          }
          return new StateDefinition.BoolState(optionalBoolean(object, "default", path, false));
        case "int": {
          final Integer defaultValue = object.has("default") ? requiredInt(object, "default", path) : null;
          final Integer min = object.has("min") ? requiredInt(object, "min", path) : null;
          final Integer max = object.has("max") ? requiredInt(object, "max", path) : null;
          if (min != null && max != null && min > max) {
            throw error(path, "min (" + min + ") est supérieur à max (" + max + ")");
          }
          return new StateDefinition.IntState(defaultValue, min, max);
        }
        case "page":
          return new StateDefinition.PageState(requiredString(object, "list", path));
        default:
          throw error(path + ".type", "type d’état inconnu « " + type + " » (attendu : enum, bool, int, page)");
      }
    }

    // --- Couches, textes -----------------------------------------------------

    private Layer layer(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      // La clé « generator » (métadonnée du studio) est volontairement ignorée.
      return new Layer(
        requiredString(object, "id", path),
        requiredString(object, "texture", path),
        requiredInt(object, "x", path),
        requiredInt(object, "y", path),
        optionalCondition(object, "visibleWhen", path)
      );
    }

    private TextElement text(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      final String alignKey = optionalString(object, "align", path, TextAlign.LEFT.key());
      final TextAlign align = TextAlign.fromKey(alignKey);
      if (align == null) {
        throw error(path + ".align", "alignement inconnu « " + alignKey + " » (attendu : left, center, right)");
      }
      final String color = optionalString(object, "color", path, null);
      if (color != null && !HEX_COLOR.matcher(color).matches()) {
        throw error(path + ".color", "couleur invalide « " + color + " » (attendu : #RRGGBB)");
      }
      return new TextElement(
        requiredString(object, "id", path),
        requiredInt(object, "x", path),
        requiredInt(object, "y", path),
        align,
        color == null ? null : color.toLowerCase(Locale.ROOT),
        requiredString(object, "value", path),
        optionalCondition(object, "visibleWhen", path)
      );
    }

    // --- Slots ---------------------------------------------------------------

    private Slot slot(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      final String kindKey = requiredString(object, "kind", path);
      final SlotKind kind = SlotKind.fromKey(kindKey);
      if (kind == null) {
        throw error(path + ".kind", "type de slot inconnu « " + kindKey + " » (attendu : button, list, input, decoration)");
      }
      final String list = optionalString(object, "list", path, null);
      if (kind == SlotKind.LIST && list == null) {
        throw error(path + ".list", "un slot « list » doit nommer sa source de données");
      }
      if (!object.has("area")) {
        throw error(path + ".area", "clé obligatoire absente");
      }
      return new Slot(
        requiredString(object, "id", path),
        kind,
        area(object.get("area"), path + ".area"),
        object.has("item") ? item(object.get("item"), path + ".item") : null,
        list,
        list(object, "onClick", path, this::action),
        optionalCondition(object, "visibleWhen", path),
        optionalCondition(object, "enabledWhen", path)
      );
    }

    private SlotArea area(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      final int col = requiredInt(object, "col", path);
      final int row = requiredInt(object, "row", path);
      final int width = optionalInt(object, "width", path, 1);
      final int height = optionalInt(object, "height", path, 1);
      if (col < 0 || col > 8) {
        throw error(path + ".col", "colonne hors de la grille (0 à 8) : " + col);
      }
      if (row < 0 || row > 5) {
        throw error(path + ".row", "ligne hors de la grille (0 à 5) : " + row);
      }
      if (width < 1) {
        throw error(path + ".width", "doit valoir au moins 1");
      }
      if (height < 1) {
        throw error(path + ".height", "doit valoir au moins 1");
      }
      return new SlotArea(col, row, width, height);
    }

    private ItemSpec item(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      return new ItemSpec(
        optionalBoolean(object, "invisible", path, false),
        optionalString(object, "material", path, null),
        optionalString(object, "head", path, null),
        optionalString(object, "name", path, null),
        stringList(object, "lore", path),
        optionalString(object, "ref", path, null)
      );
    }

    // --- Actions -------------------------------------------------------------

    private Action action(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      final String type = requiredString(object, "type", path);
      switch (type) {
        case "open": {
          final Map<String, Object> state = new LinkedHashMap<>();
          if (object.has("state")) {
            final JsonObject stateObject = object(object.get("state"), path + ".state");
            for (final Map.Entry<String, JsonElement> entry : stateObject.entrySet()) {
              state.put(entry.getKey(), primitive(entry.getValue(), path + ".state." + entry.getKey()));
            }
          }
          return new Action.Open(requiredString(object, "menu", path), state);
        }
        case "back":
          return new Action.Back();
        case "close":
          return new Action.Close();
        case "setState":
          if (!object.has("value")) {
            throw error(path + ".value", "clé obligatoire absente");
          }
          return new Action.SetState(requiredString(object, "state", path), primitive(object.get("value"), path + ".value"));
        case "nextPage":
          return new Action.NextPage(requiredString(object, "list", path));
        case "prevPage":
          return new Action.PrevPage(requiredString(object, "list", path));
        case "sound":
          return new Action.Sound(
            requiredString(object, "sound", path),
            (float) optionalNumber(object, "volume", path, 1.0),
            (float) optionalNumber(object, "pitch", path, 1.0)
          );
        case "command": {
          final String as = optionalString(object, "as", path, "player");
          final Action.CommandSender sender;
          if ("player".equals(as)) {
            sender = Action.CommandSender.PLAYER;
          } else if ("console".equals(as)) {
            sender = Action.CommandSender.CONSOLE;
          } else {
            throw error(path + ".as", "exécutant inconnu « " + as + " » (attendu : player, console)");
          }
          return new Action.Command(requiredString(object, "command", path), sender);
        }
        case "custom": {
          final Map<String, Object> args = new LinkedHashMap<>();
          if (object.has("args")) {
            final JsonObject argsObject = object(object.get("args"), path + ".args");
            argsObject.entrySet().forEach(entry -> args.put(entry.getKey(), JsonValues.toJava(entry.getValue())));
          }
          return new Action.Custom(requiredString(object, "id", path), args);
        }
        default:
          throw error(path + ".type", "type d’action inconnu « " + type
            + " » (attendu : open, back, close, setState, nextPage, prevPage, sound, command, custom)");
      }
    }

    // --- Conditions ----------------------------------------------------------

    private Condition optionalCondition(final JsonObject object, final String key, final String path) {
      if (!object.has(key) || object.get(key).isJsonNull()) {
        return null;
      }
      return condition(object.get(key), path + "." + key);
    }

    private Condition condition(final JsonElement element, final String path) {
      final JsonObject object = object(element, path);
      if (object.has("all")) {
        return new Condition.All(list(object, "all", path, this::condition));
      }
      if (object.has("any")) {
        return new Condition.Any(list(object, "any", path, this::condition));
      }
      if (object.has("not")) {
        return new Condition.Not(condition(object.get("not"), path + ".not"));
      }
      if (object.has("flag")) {
        return new Condition.Flag(requiredString(object, "flag", path));
      }
      if (object.has("state")) {
        final String state = requiredString(object, "state", path);
        if (object.has("is")) {
          return new Condition.Is(state, primitive(object.get("is"), path + ".is"));
        }
        if (object.has("in")) {
          final JsonArray array = array(object.get("in"), path + ".in");
          final List<Object> values = new ArrayList<>();
          for (int i = 0; i < array.size(); i++) {
            values.add(primitive(array.get(i), path + ".in[" + i + "]"));
          }
          return new Condition.In(state, values);
        }
        throw error(path, "une condition sur « state » demande la clé « is » ou « in »");
      }
      throw error(path, "condition inconnue (attendu une clé parmi : state, flag, all, any, not)");
    }

    // --- Outils de lecture ---------------------------------------------------

    private <T> List<T> list(final JsonObject object, final String key, final String path,
                             final BiFunction<JsonElement, String, T> reader) {
      if (!object.has(key) || object.get(key).isJsonNull()) {
        return List.of();
      }
      final String listPath = path + "." + key;
      final JsonArray array = array(object.get(key), listPath);
      final List<T> result = new ArrayList<>(array.size());
      for (int i = 0; i < array.size(); i++) {
        result.add(reader.apply(array.get(i), listPath + "[" + i + "]"));
      }
      return result;
    }

    private List<String> stringList(final JsonObject object, final String key, final String path) {
      return list(object, key, path, (element, elementPath) -> string(element, elementPath));
    }

    private JsonObject object(final JsonElement element, final String path) {
      if (element == null || !element.isJsonObject()) {
        throw error(path, "objet attendu, reçu " + describe(element));
      }
      return element.getAsJsonObject();
    }

    private JsonArray array(final JsonElement element, final String path) {
      if (element == null || !element.isJsonArray()) {
        throw error(path, "liste attendue, reçu " + describe(element));
      }
      return element.getAsJsonArray();
    }

    private String string(final JsonElement element, final String path) {
      if (element == null || !element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString()) {
        throw error(path, "chaîne attendue, reçu " + describe(element));
      }
      return element.getAsString();
    }

    private Object primitive(final JsonElement element, final String path) {
      if (element == null || !element.isJsonPrimitive()) {
        throw error(path, "valeur simple attendue (chaîne, nombre ou booléen), reçu " + describe(element));
      }
      return JsonValues.primitive(element.getAsJsonPrimitive());
    }

    private String requiredString(final JsonObject object, final String key, final String path) {
      if (!object.has(key) || object.get(key).isJsonNull()) {
        throw error(path + "." + key, "clé obligatoire absente");
      }
      return string(object.get(key), path + "." + key);
    }

    private String optionalString(final JsonObject object, final String key, final String path, final String fallback) {
      if (!object.has(key) || object.get(key).isJsonNull()) {
        return fallback;
      }
      return string(object.get(key), path + "." + key);
    }

    private int requiredInt(final JsonObject object, final String key, final String path) {
      if (!object.has(key) || object.get(key).isJsonNull()) {
        throw error(path + "." + key, "clé obligatoire absente");
      }
      return integer(object.get(key), path + "." + key);
    }

    private int optionalInt(final JsonObject object, final String key, final String path, final int fallback) {
      if (!object.has(key) || object.get(key).isJsonNull()) {
        return fallback;
      }
      return integer(object.get(key), path + "." + key);
    }

    private int integer(final JsonElement element, final String path) {
      if (element == null || !element.isJsonPrimitive() || !element.getAsJsonPrimitive().isNumber()) {
        throw error(path, "entier attendu, reçu " + describe(element));
      }
      final BigDecimal decimal = element.getAsBigDecimal();
      try {
        return decimal.intValueExact();
      } catch (final ArithmeticException exception) {
        throw error(path, "entier attendu, reçu " + decimal.toPlainString());
      }
    }

    private double optionalNumber(final JsonObject object, final String key, final String path, final double fallback) {
      if (!object.has(key) || object.get(key).isJsonNull()) {
        return fallback;
      }
      final JsonElement element = object.get(key);
      if (!element.isJsonPrimitive() || !element.getAsJsonPrimitive().isNumber()) {
        throw error(path + "." + key, "nombre attendu, reçu " + describe(element));
      }
      return element.getAsDouble();
    }

    private boolean optionalBoolean(final JsonObject object, final String key, final String path, final boolean fallback) {
      if (!object.has(key) || object.get(key).isJsonNull()) {
        return fallback;
      }
      final JsonElement element = object.get(key);
      if (!element.isJsonPrimitive() || !element.getAsJsonPrimitive().isBoolean()) {
        throw error(path + "." + key, "booléen attendu, reçu " + describe(element));
      }
      return element.getAsBoolean();
    }

    private static String describe(final JsonElement element) {
      if (element == null) {
        return "rien";
      }
      if (element.isJsonNull()) {
        return "null";
      }
      if (element.isJsonObject()) {
        return "un objet";
      }
      if (element.isJsonArray()) {
        return "une liste";
      }
      final JsonPrimitive primitive = element.getAsJsonPrimitive();
      if (primitive.isString()) {
        return "la chaîne \"" + primitive.getAsString() + "\"";
      }
      if (primitive.isBoolean()) {
        return "le booléen " + primitive.getAsBoolean();
      }
      return "le nombre " + primitive.getAsString();
    }

    private MenuFormatException error(final String path, final String message) {
      return new MenuFormatException(source, path, message);
    }
  }
}

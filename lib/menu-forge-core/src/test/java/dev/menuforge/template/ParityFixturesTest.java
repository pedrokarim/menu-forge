package dev.menuforge.template;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import dev.menuforge.model.Action;
import dev.menuforge.model.Condition;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.Slot;
import dev.menuforge.model.TextElement;
import dev.menuforge.parse.MenuParser;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Parité de la résolution (gabarits, composants) avec le studio : les fixtures
 * de {@code src/test/resources/parity} sont aussi jouées par
 * {@code studio/tests/parity.test.mjs} contre {@code resolve.ts}, avec la même
 * projection du menu résolu ({@code studio/tests/projection.mjs}).
 */
class ParityFixturesTest {

  @TestFactory
  Stream<DynamicTest> resolvesLikeTheStudio() throws IOException, URISyntaxException {
    final Path directory = Path.of(ParityFixturesTest.class.getResource("/parity").toURI());
    final List<DynamicTest> tests = new ArrayList<>();
    try (Stream<Path> files = Files.list(directory)) {
      for (final Path file : files.filter(path -> path.toString().endsWith(".json")).sorted().collect(Collectors.toList())) {
        final JsonObject fixture = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
        for (final JsonElement element : fixture.getAsJsonArray("cases")) {
          final JsonObject testCase = element.getAsJsonObject();
          final String name = file.getFileName() + " · " + testCase.get("name").getAsString();
          tests.add(DynamicTest.dynamicTest(name, () -> run(testCase)));
        }
      }
    }
    return tests.stream();
  }

  private static void run(final JsonObject testCase) {
    final MenuParser parser = new MenuParser();
    final Map<String, MenuDefinition> byId = new HashMap<>();
    for (final JsonElement menu : testCase.getAsJsonArray("menus")) {
      final MenuDefinition definition = parser.parse(menu.toString(), "parity");
      byId.put(definition.id(), definition);
    }
    final TemplateResolver resolver = new TemplateResolver(byId::get);
    final MenuDefinition target = byId.get(testCase.get("resolve").getAsString());
    if (testCase.has("error")) {
      final TemplateResolutionException error = assertThrows(TemplateResolutionException.class, () -> resolver.resolve(target));
      final String expected = testCase.get("error").getAsString();
      assertTrue(error.getMessage().toLowerCase(Locale.ROOT).contains(expected), error.getMessage());
      return;
    }
    assertEquals(testCase.get("expected"), project(resolver.resolve(target)));
  }

  /** Même forme que {@code projectMenu} du studio. */
  private static JsonObject project(final MenuDefinition menu) {
    final JsonObject projected = new JsonObject();
    final JsonArray state = new JsonArray();
    menu.state().forEach((name, definition) -> {
      final JsonArray entry = new JsonArray();
      entry.add(name);
      entry.add(definition.type());
      state.add(entry);
    });
    projected.add("state", state);

    final JsonArray layers = new JsonArray();
    for (final Layer layer : menu.layers()) {
      final JsonObject object = new JsonObject();
      object.addProperty("id", layer.id());
      object.addProperty("texture", layer.texture());
      object.addProperty("x", layer.x());
      object.addProperty("y", layer.y());
      putCondition(object, "visibleWhen", layer.visibleWhen());
      layers.add(object);
    }
    projected.add("layers", layers);

    final JsonArray texts = new JsonArray();
    for (final TextElement text : menu.texts()) {
      final JsonObject object = new JsonObject();
      object.addProperty("id", text.id());
      object.addProperty("x", text.x());
      object.addProperty("y", text.y());
      object.addProperty("value", text.value());
      putCondition(object, "visibleWhen", text.visibleWhen());
      texts.add(object);
    }
    projected.add("texts", texts);

    final JsonArray slots = new JsonArray();
    for (final Slot slot : menu.slots()) {
      final JsonObject object = new JsonObject();
      object.addProperty("id", slot.id());
      object.addProperty("kind", slot.kind().key());
      object.addProperty("col", slot.area().col());
      object.addProperty("row", slot.area().row());
      object.addProperty("width", slot.area().width());
      object.addProperty("height", slot.area().height());
      final JsonArray actions = new JsonArray();
      for (final Action action : slot.onClick()) {
        actions.add(action.type());
      }
      object.add("actions", actions);
      putCondition(object, "visibleWhen", slot.visibleWhen());
      putCondition(object, "enabledWhen", slot.enabledWhen());
      slots.add(object);
    }
    projected.add("slots", slots);
    return projected;
  }

  private static void putCondition(final JsonObject target, final String key, final Condition condition) {
    if (condition != null) {
      target.add(key, condition(condition));
    }
  }

  /** Condition sous sa forme du format ({@code {"state", "is"}}, {@code {"all": [...]}}…). */
  private static JsonObject condition(final Condition condition) {
    final JsonObject object = new JsonObject();
    if (condition instanceof Condition.Is is) {
      object.addProperty("state", is.state());
      object.add("is", primitive(is.value()));
    } else if (condition instanceof Condition.In in) {
      object.addProperty("state", in.state());
      final JsonArray values = new JsonArray();
      in.values().forEach(value -> values.add(primitive(value)));
      object.add("in", values);
    } else if (condition instanceof Condition.Flag flag) {
      object.addProperty("flag", flag.name());
    } else if (condition instanceof Condition.All all) {
      object.add("all", conditions(all.conditions()));
    } else if (condition instanceof Condition.Any any) {
      object.add("any", conditions(any.conditions()));
    } else if (condition instanceof Condition.Not not) {
      object.add("not", condition(not.condition()));
    }
    return object;
  }

  private static JsonArray conditions(final List<Condition> conditions) {
    final JsonArray array = new JsonArray();
    conditions.forEach(child -> array.add(condition(child)));
    return array;
  }

  private static JsonPrimitive primitive(final Object value) {
    if (value instanceof Boolean bool) {
      return new JsonPrimitive(bool);
    }
    if (value instanceof Number number) {
      return new JsonPrimitive(number);
    }
    return new JsonPrimitive(String.valueOf(value));
  }
}

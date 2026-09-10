package dev.menuforge.parse;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Conversion d’arbres Gson en objets Java simples ({@link String},
 * {@link Boolean}, {@link Long}, {@link Double}, {@link List}, {@link Map}),
 * pour ne pas exposer Gson dans le modèle.
 */
public final class JsonValues {

  private JsonValues() {
  }

  /** Convertit un élément JSON (null JSON → {@code null}). */
  public static Object toJava(final JsonElement element) {
    if (element == null || element.isJsonNull()) {
      return null;
    }
    if (element.isJsonPrimitive()) {
      return primitive(element.getAsJsonPrimitive());
    }
    if (element.isJsonArray()) {
      final JsonArray array = element.getAsJsonArray();
      final List<Object> list = new ArrayList<>(array.size());
      array.forEach(child -> list.add(toJava(child)));
      return list;
    }
    final JsonObject object = element.getAsJsonObject();
    final Map<String, Object> map = new LinkedHashMap<>();
    object.entrySet().forEach(entry -> map.put(entry.getKey(), toJava(entry.getValue())));
    return map;
  }

  /** Convertit une primitive : les nombres entiers deviennent des {@link Long}. */
  public static Object primitive(final JsonPrimitive primitive) {
    if (primitive.isBoolean()) {
      return primitive.getAsBoolean();
    }
    if (primitive.isNumber()) {
      final BigDecimal decimal = primitive.getAsBigDecimal();
      try {
        return decimal.longValueExact();
      } catch (final ArithmeticException notAnInteger) {
        return decimal.doubleValue();
      }
    }
    return primitive.getAsString();
  }
}

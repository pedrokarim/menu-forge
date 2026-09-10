package dev.menuforge.model;

import dev.menuforge.state.ConditionContext;

import java.util.List;
import java.util.Objects;

/**
 * Déclaration d’une variable d’état (voir {@code docs/format.md}, § État).
 * L’état vit par joueur et par ouverture.
 */
public sealed interface StateDefinition {

  /** Type tel qu’écrit dans le format. */
  String type();

  /** Valeur au moment de l’ouverture du menu. */
  Object initialValue();

  /**
   * Convertit et valide une valeur brute (issue d’une action ou d’une API).
   *
   * @throws IllegalArgumentException si la valeur ne convient pas
   */
  Object coerce(Object raw);

  /** Une valeur parmi une liste fermée. */
  record EnumState(List<String> values, String defaultValue) implements StateDefinition {
    public EnumState {
      values = List.copyOf(values);
      Objects.requireNonNull(defaultValue, "default");
      if (values.isEmpty()) {
        throw new IllegalArgumentException("un état enum doit avoir au moins une valeur");
      }
      if (!values.contains(defaultValue)) {
        throw new IllegalArgumentException("la valeur par défaut « " + defaultValue + " » n’est pas dans values");
      }
    }

    @Override
    public String type() {
      return "enum";
    }

    @Override
    public Object initialValue() {
      return defaultValue;
    }

    @Override
    public Object coerce(final Object raw) {
      final String value = ConditionContext.normalize(raw);
      if (!values.contains(value)) {
        throw new IllegalArgumentException("valeur « " + value + " » absente de " + values);
      }
      return value;
    }
  }

  /** Un booléen. */
  record BoolState(boolean defaultValue) implements StateDefinition {
    @Override
    public String type() {
      return "bool";
    }

    @Override
    public Object initialValue() {
      return defaultValue;
    }

    @Override
    public Object coerce(final Object raw) {
      if (raw instanceof Boolean bool) {
        return bool;
      }
      final String value = ConditionContext.normalize(raw);
      if ("true".equals(value) || "false".equals(value)) {
        return Boolean.parseBoolean(value);
      }
      throw new IllegalArgumentException("booléen attendu, reçu « " + value + " »");
    }
  }

  /** Un entier, éventuellement borné (la valeur est ramenée dans les bornes). */
  record IntState(Integer defaultValue, Integer min, Integer max) implements StateDefinition {
    public IntState {
      if (min != null && max != null && min > max) {
        throw new IllegalArgumentException("min > max");
      }
    }

    @Override
    public String type() {
      return "int";
    }

    @Override
    public Object initialValue() {
      final int base = defaultValue != null ? defaultValue : (min != null ? min : 0);
      return clamp(base);
    }

    @Override
    public Object coerce(final Object raw) {
      final long value;
      if (raw instanceof Number number) {
        value = Math.round(number.doubleValue());
      } else {
        try {
          value = Long.parseLong(String.valueOf(raw).trim());
        } catch (final NumberFormatException exception) {
          throw new IllegalArgumentException("entier attendu, reçu « " + raw + " »");
        }
      }
      return clamp((int) Math.max(Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, value)));
    }

    private int clamp(final int value) {
      int result = value;
      if (min != null) {
        result = Math.max(min, result);
      }
      if (max != null) {
        result = Math.min(max, result);
      }
      return result;
    }
  }

  /**
   * Page courante (1-based) de la liste {@code list}. Expose les variables
   * {@code <nom>.number} / {@code <nom>.count} et les drapeaux
   * {@code <nom>.hasPrev} / {@code <nom>.hasNext}.
   */
  record PageState(String list) implements StateDefinition {
    public PageState {
      Objects.requireNonNull(list, "list");
    }

    @Override
    public String type() {
      return "page";
    }

    @Override
    public Object initialValue() {
      return 1;
    }

    @Override
    public Object coerce(final Object raw) {
      // Borne basse seulement : le nombre de pages n’est connu qu’à l’affichage.
      return new IntState(1, 1, null).coerce(raw);
    }
  }
}

package dev.menuforge.model;

import dev.menuforge.state.ConditionContext;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.function.Consumer;

/**
 * Condition booléenne évaluée contre un {@link ConditionContext}
 * (voir {@code docs/format.md}, § Conditions).
 */
public sealed interface Condition {

  /** Évalue la condition. */
  boolean test(ConditionContext context);

  /** Parcourt la condition et ses sous-conditions (profondeur d’abord). */
  default void visit(final Consumer<Condition> visitor) {
    visitor.accept(this);
  }

  /** Noms des drapeaux référencés par cette condition (récursivement). */
  default Set<String> referencedFlags() {
    final Set<String> flags = new java.util.LinkedHashSet<>();
    visit(condition -> {
      if (condition instanceof Flag flag) {
        flags.add(flag.name());
      }
    });
    return flags;
  }

  /** {@code { "state": s, "is": v }} : l’état vaut exactement {@code value}. */
  record Is(String state, Object value) implements Condition {
    public Is {
      Objects.requireNonNull(state, "state");
    }

    @Override
    public boolean test(final ConditionContext context) {
      return Objects.equals(context.normalizedValue(state), ConditionContext.normalize(value));
    }
  }

  /** {@code { "state": s, "in": [...] }} : l’état vaut l’une des valeurs. */
  record In(String state, List<Object> values) implements Condition {
    public In {
      Objects.requireNonNull(state, "state");
      values = List.copyOf(values);
    }

    @Override
    public boolean test(final ConditionContext context) {
      final String current = context.normalizedValue(state);
      for (final Object value : values) {
        if (Objects.equals(current, ConditionContext.normalize(value))) {
          return true;
        }
      }
      return false;
    }
  }

  /** {@code { "flag": f }} : le drapeau est levé. */
  record Flag(String name) implements Condition {
    public Flag {
      Objects.requireNonNull(name, "flag");
    }

    @Override
    public boolean test(final ConditionContext context) {
      return context.hasFlag(name);
    }
  }

  /** {@code { "all": [...] }} : toutes les conditions (vrai si la liste est vide). */
  record All(List<Condition> conditions) implements Condition {
    public All {
      conditions = List.copyOf(conditions);
    }

    @Override
    public boolean test(final ConditionContext context) {
      for (final Condition condition : conditions) {
        if (!condition.test(context)) {
          return false;
        }
      }
      return true;
    }

    @Override
    public void visit(final Consumer<Condition> visitor) {
      visitor.accept(this);
      conditions.forEach(child -> child.visit(visitor));
    }
  }

  /** {@code { "any": [...] }} : au moins une condition (faux si la liste est vide). */
  record Any(List<Condition> conditions) implements Condition {
    public Any {
      conditions = List.copyOf(conditions);
    }

    @Override
    public boolean test(final ConditionContext context) {
      for (final Condition condition : conditions) {
        if (condition.test(context)) {
          return true;
        }
      }
      return false;
    }

    @Override
    public void visit(final Consumer<Condition> visitor) {
      visitor.accept(this);
      conditions.forEach(child -> child.visit(visitor));
    }
  }

  /** {@code { "not": {...} }} : négation. */
  record Not(Condition condition) implements Condition {
    public Not {
      Objects.requireNonNull(condition, "not");
    }

    @Override
    public boolean test(final ConditionContext context) {
      return !condition.test(context);
    }

    @Override
    public void visit(final Consumer<Condition> visitor) {
      visitor.accept(this);
      condition.visit(visitor);
    }
  }
}

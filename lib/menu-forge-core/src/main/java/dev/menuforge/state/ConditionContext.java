package dev.menuforge.state;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Contexte d’évaluation des conditions : valeurs d’état et drapeaux levés.
 *
 * <p>Les comparaisons se font sur une forme textuelle normalisée
 * ({@link #normalize(Object)}) : {@code 3}, {@code 3.0} et {@code "3"} sont
 * égaux, de même que {@code true} et {@code "true"}.
 *
 * @param stateValues valeurs courantes des variables d’état (page = numéro 1-based)
 * @param flags       drapeaux levés ({@code page.hasNext}, {@code viewer.isStaff}…)
 */
public record ConditionContext(Map<String, Object> stateValues, Set<String> flags) {

  /** Contexte vide : aucun état, aucun drapeau. */
  public static final ConditionContext EMPTY = new ConditionContext(Map.of(), Set.of());

  public ConditionContext {
    stateValues = Collections.unmodifiableMap(new LinkedHashMap<>(stateValues == null ? Map.of() : stateValues));
    flags = Collections.unmodifiableSet(new LinkedHashSet<>(flags == null ? Set.of() : flags));
  }

  /** Valeur normalisée d’une variable d’état, ou {@code null} si absente. */
  public String normalizedValue(final String state) {
    return normalize(stateValues.get(state));
  }

  /** Le drapeau est-il levé ? */
  public boolean hasFlag(final String flag) {
    return flags.contains(flag);
  }

  /** Copie du contexte avec des drapeaux supplémentaires. */
  public ConditionContext withFlags(final Set<String> extraFlags) {
    final Set<String> merged = new LinkedHashSet<>(flags);
    merged.addAll(extraFlags);
    return new ConditionContext(stateValues, merged);
  }

  /**
   * Forme textuelle normalisée d’une valeur : les nombres entiers perdent leur
   * partie décimale, les booléens deviennent {@code "true"} / {@code "false"}.
   */
  public static String normalize(final Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof Number number) {
      final double asDouble = number.doubleValue();
      if (asDouble == Math.rint(asDouble) && !Double.isInfinite(asDouble)) {
        return Long.toString((long) asDouble);
      }
      return Double.toString(asDouble);
    }
    return value.toString();
  }
}

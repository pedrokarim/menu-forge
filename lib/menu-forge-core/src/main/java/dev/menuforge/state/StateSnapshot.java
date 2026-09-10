package dev.menuforge.state;

import dev.menuforge.model.StateDefinition;
import dev.menuforge.text.VariableResolver;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Photographie de l’état d’un menu ouvert : valeurs effectives, nombre de pages
 * de chaque état {@code page}, drapeaux et variables qui en dérivent.
 *
 * <p>Pour un état {@code page} nommé {@code p} : la valeur est le numéro de
 * page (1-based, ramené entre 1 et le nombre de pages), les drapeaux
 * {@code p.hasPrev} / {@code p.hasNext} sont levés selon la position, et les
 * variables {@code p.number} / {@code p.count} sont exposées.
 */
public final class StateSnapshot {

  private final Map<String, StateDefinition> definitions;
  private final Map<String, Object> values;
  private final Map<String, Integer> pageCounts;
  private final Set<String> flags;

  private StateSnapshot(final Map<String, StateDefinition> definitions, final Map<String, Object> values,
                        final Map<String, Integer> pageCounts, final Set<String> flags) {
    this.definitions = definitions;
    this.values = Collections.unmodifiableMap(values);
    this.pageCounts = Collections.unmodifiableMap(pageCounts);
    this.flags = Collections.unmodifiableSet(flags);
  }

  /**
   * Construit la photographie.
   *
   * @param definitions déclarations d’état du menu (résolu)
   * @param current     valeurs courantes ; une variable absente prend sa valeur initiale
   * @param pageCounts  nombre de pages par nom d’état {@code page} (absent = 1)
   */
  public static StateSnapshot of(final Map<String, StateDefinition> definitions, final Map<String, Object> current,
                                 final Map<String, Integer> pageCounts) {
    final Map<String, Object> values = new LinkedHashMap<>();
    final Map<String, Integer> counts = new LinkedHashMap<>();
    final Set<String> flags = new LinkedHashSet<>();
    for (final Map.Entry<String, StateDefinition> entry : definitions.entrySet()) {
      final String name = entry.getKey();
      final StateDefinition definition = entry.getValue();
      final Object raw = current != null && current.containsKey(name) ? current.get(name) : definition.initialValue();
      if (definition instanceof StateDefinition.PageState) {
        final int count = Math.max(1, pageCounts == null ? 1 : pageCounts.getOrDefault(name, 1));
        final int number = Math.max(1, Math.min(count, toInt(raw)));
        values.put(name, number);
        counts.put(name, count);
        if (number > 1) {
          flags.add(name + ".hasPrev");
        }
        if (number < count) {
          flags.add(name + ".hasNext");
        }
      } else {
        values.put(name, raw);
      }
    }
    return new StateSnapshot(definitions, values, counts, flags);
  }

  /**
   * Valeurs initiales d’un menu, avec d’éventuelles valeurs imposées à
   * l’ouverture (validées par chaque déclaration ; les clés inconnues sont
   * refusées).
   *
   * @throws IllegalArgumentException si une valeur imposée est invalide
   */
  public static Map<String, Object> initialValues(final Map<String, StateDefinition> definitions,
                                                  final Map<String, Object> overrides) {
    final Map<String, Object> values = new LinkedHashMap<>();
    definitions.forEach((name, definition) -> values.put(name, definition.initialValue()));
    if (overrides != null) {
      for (final Map.Entry<String, Object> entry : overrides.entrySet()) {
        final StateDefinition definition = definitions.get(entry.getKey());
        if (definition == null) {
          throw new IllegalArgumentException("état inconnu : « " + entry.getKey() + " »");
        }
        values.put(entry.getKey(), definition.coerce(entry.getValue()));
      }
    }
    return values;
  }

  /** Valeurs effectives (page = numéro ramené dans les bornes). */
  public Map<String, Object> values() {
    return values;
  }

  /** Nombre de pages de l’état {@code page} nommé {@code name} (1 si inconnu). */
  public int pageCount(final String name) {
    return pageCounts.getOrDefault(name, 1);
  }

  /** Drapeaux dérivés de l’état ({@code p.hasPrev}, {@code p.hasNext}). */
  public Set<String> flags() {
    return flags;
  }

  /** Déclarations d’état utilisées. */
  public Map<String, StateDefinition> definitions() {
    return definitions;
  }

  /** Contexte de conditions : état + drapeaux dérivés + drapeaux fournis. */
  public ConditionContext context(final Set<String> extraFlags) {
    final Set<String> merged = new LinkedHashSet<>(flags);
    if (extraFlags != null) {
      merged.addAll(extraFlags);
    }
    return new ConditionContext(values, merged);
  }

  /**
   * Variables dérivées de l’état : {@code state.<nom>}, et pour chaque état
   * {@code page} nommé {@code p} : {@code p.number}, {@code p.count}. Renvoie
   * {@code null} pour un nom inconnu.
   */
  public String variable(final String name) {
    if (name.startsWith("state.")) {
      final String state = name.substring("state.".length());
      return values.containsKey(state) ? ConditionContext.normalize(values.get(state)) : null;
    }
    final int dot = name.lastIndexOf('.');
    if (dot > 0) {
      final String state = name.substring(0, dot);
      final String property = name.substring(dot + 1);
      if (definitions.get(state) instanceof StateDefinition.PageState) {
        if ("number".equals(property)) {
          return ConditionContext.normalize(values.get(state));
        }
        if ("count".equals(property)) {
          return Integer.toString(pageCount(state));
        }
      }
    }
    return null;
  }

  /** Cette photographie vue comme source de variables. */
  public VariableResolver asResolver() {
    return this::variable;
  }

  private static int toInt(final Object raw) {
    if (raw instanceof Number number) {
      return (int) Math.round(number.doubleValue());
    }
    try {
      return Integer.parseInt(String.valueOf(raw).trim());
    } catch (final NumberFormatException exception) {
      return 1;
    }
  }
}

package dev.menuforge.text;

/**
 * Source de valeurs pour les variables {@code {nom}}.
 */
@FunctionalInterface
public interface VariableResolver {

  /** Aucun résultat, pour aucune variable. */
  VariableResolver NONE = name -> null;

  /** Valeur de la variable, ou {@code null} si cette source ne la connaît pas. */
  String resolve(String name);

  /** Chaîne : cette source d’abord, puis {@code next} pour ce qu’elle ignore. */
  default VariableResolver or(final VariableResolver next) {
    return name -> {
      final String value = resolve(name);
      return value != null ? value : next.resolve(name);
    };
  }
}

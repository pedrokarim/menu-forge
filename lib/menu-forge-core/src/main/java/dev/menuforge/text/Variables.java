package dev.menuforge.text;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Interpolation des variables {@code {nom}} dans les textes du format.
 *
 * <p>Une variable inconnue est laissée telle quelle ({@code {nom}}), ce qui
 * rend l’oubli visible en jeu plutôt que silencieux.
 */
public final class Variables {

  /** Motif d’une variable : accolades autour d’un nom sans espace ni accolade. */
  public static final Pattern PATTERN = Pattern.compile("\\{([A-Za-z0-9_.:\\-]+)}");

  private Variables() {
  }

  /** Remplace chaque {@code {nom}} par sa valeur. */
  public static String interpolate(final String template, final VariableResolver resolver) {
    if (template == null || template.indexOf('{') < 0) {
      return template;
    }
    final Matcher matcher = PATTERN.matcher(template);
    final StringBuilder builder = new StringBuilder();
    while (matcher.find()) {
      final String value = resolver.resolve(matcher.group(1));
      matcher.appendReplacement(builder, Matcher.quoteReplacement(value != null ? value : matcher.group()));
    }
    matcher.appendTail(builder);
    return builder.toString();
  }

  /** Noms des variables présentes dans le texte. */
  public static Set<String> referenced(final String template) {
    final Set<String> names = new LinkedHashSet<>();
    if (template != null) {
      final Matcher matcher = PATTERN.matcher(template);
      while (matcher.find()) {
        names.add(matcher.group(1));
      }
    }
    return names;
  }
}

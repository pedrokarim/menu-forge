package dev.menuforge.paper.api;

import org.bukkit.entity.Player;

/**
 * Valeur des variables {@code {nom}} que la lib ne connaît pas (elle résout
 * elle-même {@code viewer}, {@code viewer.name}, {@code viewer.uuid},
 * {@code state.*} et les variables de pagination). Interrogés dans l’ordre
 * d’enregistrement ; une variable sans réponse reste affichée telle quelle.
 */
@FunctionalInterface
public interface PlaceholderResolver {

  /** Valeur de la variable, ou {@code null} si inconnue. */
  String resolve(Player viewer, String name);
}

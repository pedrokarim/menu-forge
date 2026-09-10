package dev.menuforge.paper.api;

import org.bukkit.entity.Player;

/**
 * Fournit les drapeaux que la lib ne dérive pas elle-même (tout sauf
 * {@code <page>.hasPrev} / {@code <page>.hasNext}) : {@code viewer.isStaff},
 * drapeaux custom… Les fournisseurs sont interrogés dans l’ordre
 * d’enregistrement ; le premier qui répond autre chose que {@code null} gagne,
 * et un drapeau sans réponse vaut {@code false}.
 */
@FunctionalInterface
public interface FlagProvider {

  /** Valeur du drapeau pour ce joueur, ou {@code null} si ce fournisseur ne le connaît pas. */
  Boolean flag(Player viewer, String name);
}

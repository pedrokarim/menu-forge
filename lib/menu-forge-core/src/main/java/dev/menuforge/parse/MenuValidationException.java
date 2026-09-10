package dev.menuforge.parse;

import dev.menuforge.MenuForgeException;

import java.util.List;

/** Menu résolu incohérent (ids en double, slot hors grille, état inconnu…). */
public class MenuValidationException extends MenuForgeException {

  private final String menuId;
  private final List<String> problems;

  public MenuValidationException(final String menuId, final List<String> problems) {
    super("menu « " + menuId + " » invalide :\n  - " + String.join("\n  - ", problems));
    this.menuId = menuId;
    this.problems = List.copyOf(problems);
  }

  /** Menu en cause. */
  public String menuId() {
    return menuId;
  }

  /** Problèmes relevés, un par ligne. */
  public List<String> problems() {
    return problems;
  }
}

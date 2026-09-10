package dev.menuforge.template;

import dev.menuforge.MenuForgeException;

/** Gabarit introuvable ou cycle d’héritage entre gabarits. */
public class TemplateResolutionException extends MenuForgeException {

  public TemplateResolutionException(final String message) {
    super(message);
  }
}

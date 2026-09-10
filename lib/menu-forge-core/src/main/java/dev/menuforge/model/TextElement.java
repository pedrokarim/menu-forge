package dev.menuforge.model;

import dev.menuforge.state.ConditionContext;

import java.util.Objects;

/**
 * Un texte dynamique du titre (par exemple « 3/46 »).
 *
 * @param id          identifiant
 * @param x           abscisse du point d’ancrage (pixels fenêtre)
 * @param y           ordonnée du haut du texte (pixels fenêtre)
 * @param align       alignement par rapport à {@code x}
 * @param color       couleur hexadécimale {@code #RRGGBB}, ou {@code null} (couleur du titre)
 * @param value       texte avec variables {@code {…}}
 * @param visibleWhen condition de visibilité, {@code null} = toujours visible
 */
public record TextElement(
  String id,
  int x,
  int y,
  TextAlign align,
  String color,
  String value,
  Condition visibleWhen
) implements Identified {

  public TextElement {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(value, "value");
    align = align == null ? TextAlign.LEFT : align;
  }

  /** Le texte est-il visible dans ce contexte ? */
  public boolean isVisible(final ConditionContext context) {
    return visibleWhen == null || visibleWhen.test(context);
  }
}

package dev.menuforge.model;

import dev.menuforge.state.ConditionContext;

import java.util.Objects;

/**
 * Une image du titre. La lib la recadre sur ses pixels visibles, calcule son
 * avance et en fait un glyphe de police.
 *
 * @param id          identifiant unique dans le menu
 * @param texture     chemin du PNG, relatif au dossier {@code textures/} du projet
 * @param x           abscisse du coin haut-gauche (pixels fenêtre)
 * @param y           ordonnée du coin haut-gauche (pixels fenêtre)
 * @param visibleWhen condition de visibilité, {@code null} = toujours visible
 */
public record Layer(String id, String texture, int x, int y, Condition visibleWhen) implements Identified {

  public Layer {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(texture, "texture");
  }

  /** La couche est-elle visible dans ce contexte ? */
  public boolean isVisible(final ConditionContext context) {
    return visibleWhen == null || visibleWhen.test(context);
  }
}

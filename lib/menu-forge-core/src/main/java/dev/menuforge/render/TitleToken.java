package dev.menuforge.render;

/**
 * Jeton de composition du titre. La suite de jetons est le contrat commun avec
 * le studio (TypeScript) : pour un même menu et un même contexte, les deux
 * implémentations doivent produire exactement les mêmes jetons.
 */
public sealed interface TitleToken {

  /** Décalage horizontal du curseur (pixels, positif vers la droite). */
  record Shift(int amount) implements TitleToken {
  }

  /**
   * Glyphe d’une couche.
   *
   * @param layerId id de la couche
   * @param ascent  ascent du provider bitmap
   * @param height  hauteur du provider (= hauteur du PNG généré, complété en bas si besoin)
   * @param advance avance du curseur après le glyphe
   */
  record Glyph(String layerId, int ascent, int height, int advance) implements TitleToken {
  }

  /**
   * Texte dynamique, déjà interpolé.
   *
   * @param value  texte affiché
   * @param ascent ascent de la police de texte à utiliser
   * @param color  couleur {@code #rrggbb}, ou {@code null}
   */
  record Text(String value, int ascent, String color) implements TitleToken {
  }
}

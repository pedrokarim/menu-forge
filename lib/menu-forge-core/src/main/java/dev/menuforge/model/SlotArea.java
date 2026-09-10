package dev.menuforge.model;

import java.util.ArrayList;
import java.util.List;

/**
 * Rectangle de slots dans la grille du coffre.
 *
 * @param col    colonne de départ (0 à 8)
 * @param row    ligne de départ (0 à lignes − 1)
 * @param width  largeur en slots (au moins 1)
 * @param height hauteur en slots (au moins 1)
 */
public record SlotArea(int col, int row, int width, int height) {

  public SlotArea {
    if (col < 0 || row < 0) {
      throw new IllegalArgumentException("col et row doivent être positifs");
    }
    if (width < 1 || height < 1) {
      throw new IllegalArgumentException("width et height doivent valoir au moins 1");
    }
  }

  /** Zone d’un seul slot. */
  public static SlotArea single(final int col, final int row) {
    return new SlotArea(col, row, 1, 1);
  }

  /** Nombre de slots couverts. */
  public int size() {
    return width * height;
  }

  /** La zone tient-elle dans un coffre de {@code rows} lignes ? */
  public boolean fitsIn(final int rows) {
    return col + width <= ContainerSpec.COLUMNS && row + height <= rows;
  }

  /** Index des slots couverts dans l’inventaire, ligne par ligne (gauche → droite, haut → bas). */
  public List<Integer> slotIndices() {
    final List<Integer> indices = new ArrayList<>(size());
    for (int r = row; r < row + height; r++) {
      for (int c = col; c < col + width; c++) {
        indices.add(r * ContainerSpec.COLUMNS + c);
      }
    }
    return indices;
  }
}

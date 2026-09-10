package dev.menuforge.render;

/**
 * Géométrie de la fenêtre d’un coffre vanilla, en pixels GUI (voir
 * {@code docs/rendering.md}, § 2). Origine : coin haut-gauche de la fenêtre.
 */
public final class ChestGeometry {

  /** Largeur de la fenêtre. */
  public static final int WINDOW_WIDTH = 176;
  /** Côté d’une cellule de slot (bordure comprise). */
  public static final int CELL_SIZE = 18;

  private ChestGeometry() {
  }

  /** Hauteur de la fenêtre : {@code 114 + 18 × lignes}. */
  public static int windowHeight(final int rows) {
    return 114 + CELL_SIZE * rows;
  }

  /** Abscisse de l’item (16×16) d’une colonne. */
  public static int itemX(final int col) {
    return 8 + CELL_SIZE * col;
  }

  /** Ordonnée de l’item (16×16) d’une ligne du coffre. */
  public static int itemY(final int row) {
    return 18 + CELL_SIZE * row;
  }

  /** Abscisse de la cellule (18×18) d’une colonne. */
  public static int cellX(final int col) {
    return itemX(col) - 1;
  }

  /** Ordonnée de la cellule (18×18) d’une ligne du coffre. */
  public static int cellY(final int row) {
    return itemY(row) - 1;
  }

  /** Ordonnée de l’item d’une ligne ({@code 0} à {@code 2}) de l’inventaire du joueur. */
  public static int playerInventoryItemY(final int rows, final int inventoryRow) {
    return 31 + CELL_SIZE * rows + CELL_SIZE * inventoryRow;
  }

  /** Ordonnée des items de la barre d’action. */
  public static int hotbarItemY(final int rows) {
    return 89 + CELL_SIZE * rows;
  }
}

package dev.menuforge.calibration;

import dev.menuforge.image.TextureLibrary;
import dev.menuforge.model.Action;
import dev.menuforge.model.ContainerSpec;
import dev.menuforge.model.ItemSpec;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.Slot;
import dev.menuforge.model.SlotArea;
import dev.menuforge.model.SlotKind;
import dev.menuforge.model.TextAlign;
import dev.menuforge.model.TextElement;
import dev.menuforge.render.ChestGeometry;

import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Menu de calibration, généré par code, pour valider le modèle de rendu en jeu.
 *
 * <p>Une seule couche couvre toute la fenêtre, posée en {@code (0, 0)} :
 * <ul>
 *   <li>règles graduées sur les bords haut et gauche : un trait tous les 2 px,
 *       plus long tous les 10 px, plus long encore tous les 50 px (rouge) ;</li>
 *   <li>cadre de la fenêtre théorique (jaune) ;</li>
 *   <li>cellule théorique 18×18 de chaque slot du coffre (vert) et de
 *       l’inventaire du joueur (cyan), avec un point magenta au coin de
 *       l’item 16×16 ;</li>
 *   <li>un repère vertical blanc en {@code x = 88} (centre), sous la grille.</li>
 * </ul>
 * Des pierres dans les quatre coins du coffre permettent de comparer la
 * position réelle des items aux cellules dessinées, et trois textes testent
 * l’alignement gauche, centré et droit.
 */
public final class CalibrationMenu {

  /** Id du menu de calibration. */
  public static final String MENU_ID = "menuforge_calibration";
  /** Chemin (virtuel) de sa texture. */
  public static final String TEXTURE = "__menuforge__/calibration.png";

  private static final int RULER = 0xFFFF3030;
  private static final int WINDOW = 0xFFFFD800;
  private static final int CHEST_CELL = 0xFF00C040;
  private static final int PLAYER_CELL = 0xFF00C8FF;
  private static final int ITEM_CORNER = 0xFFFF00FF;
  private static final int CENTER = 0xFFFFFFFF;

  private CalibrationMenu() {
  }

  /** Enregistre la texture dans la bibliothèque et renvoie le menu (déjà résolu). */
  public static MenuDefinition register(final TextureLibrary textures, final int rows) {
    textures.register(TEXTURE, texture(rows));
    return definition(rows);
  }

  /** Texture de calibration pour un coffre de {@code rows} lignes. */
  public static BufferedImage texture(final int rows) {
    final int width = ChestGeometry.WINDOW_WIDTH;
    final int height = ChestGeometry.windowHeight(rows);
    final BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);

    // Cadre de la fenêtre.
    rectangle(image, 0, 0, width, height, WINDOW);

    // Cellules du coffre.
    for (int row = 0; row < rows; row++) {
      for (int col = 0; col < ContainerSpec.COLUMNS; col++) {
        cell(image, ChestGeometry.itemX(col), ChestGeometry.itemY(row), CHEST_CELL);
      }
    }
    // Inventaire du joueur et barre d’action.
    for (int col = 0; col < ContainerSpec.COLUMNS; col++) {
      for (int inventoryRow = 0; inventoryRow < 3; inventoryRow++) {
        cell(image, ChestGeometry.itemX(col), ChestGeometry.playerInventoryItemY(rows, inventoryRow), PLAYER_CELL);
      }
      cell(image, ChestGeometry.itemX(col), ChestGeometry.hotbarItemY(rows), PLAYER_CELL);
    }

    // Règles graduées (dessinées en dernier, par-dessus le cadre).
    for (int x = 0; x < width; x += 2) {
      final int length = x % 50 == 0 ? 7 : (x % 10 == 0 ? 5 : 2);
      for (int y = 0; y < length && y < height; y++) {
        image.setRGB(x, y, RULER);
      }
    }
    for (int y = 0; y < height; y += 2) {
      final int length = y % 50 == 0 ? 7 : (y % 10 == 0 ? 5 : 2);
      for (int x = 0; x < length && x < width; x++) {
        image.setRGB(x, y, RULER);
      }
    }

    // Repère du centre, entre la grille et l’inventaire.
    final int gridBottom = ChestGeometry.cellY(rows);
    for (int y = gridBottom + 1; y < gridBottom + 11 && y < height; y++) {
      image.setRGB(ChestGeometry.WINDOW_WIDTH / 2, y, CENTER);
    }
    return image;
  }

  /** Définition du menu de calibration (sans gabarit). */
  public static MenuDefinition definition(final int rows) {
    final int lastRow = rows - 1;
    final int centerTextY = ChestGeometry.cellY(rows) + 2;
    final List<TextElement> texts = List.of(
      new TextElement("left", 8, 6, TextAlign.LEFT, "#ffffff", "Calibration", null),
      new TextElement("right", 168, 6, TextAlign.RIGHT, "#ffffff", "x168", null),
      new TextElement("center", 88, centerTextY, TextAlign.CENTER, "#ffffff", "88", null)
    );
    final List<Slot> slots = new ArrayList<>();
    final int[][] corners = {{0, 0}, {8, 0}, {0, lastRow}, {8, lastRow}};
    for (final int[] corner : corners) {
      slots.add(new Slot("corner_" + corner[0] + "_" + corner[1], SlotKind.DECORATION,
        SlotArea.single(corner[0], corner[1]),
        new ItemSpec(false, "STONE", null, "<gray>col " + corner[0] + ", ligne " + corner[1], List.of(), null),
        null, List.of(), null, null));
    }
    if (rows > 1) {
      slots.add(new Slot("close", SlotKind.BUTTON, SlotArea.single(4, lastRow),
        new ItemSpec(false, "BARRIER", null, "<red>Fermer", List.of(), null),
        null, List.of(new Action.Close()), null, null));
    }
    return new MenuDefinition(MenuDefinition.FORMAT_VERSION, MENU_ID, "Calibration", false, List.of(),
      ContainerSpec.chest(rows), Map.of(),
      List.of(new Layer("grid", TEXTURE, 0, 0, null)),
      texts, slots);
  }

  private static void cell(final BufferedImage image, final int itemX, final int itemY, final int color) {
    rectangle(image, itemX - 1, itemY - 1, ChestGeometry.CELL_SIZE, ChestGeometry.CELL_SIZE, color);
    set(image, itemX, itemY, ITEM_CORNER);
  }

  private static void rectangle(final BufferedImage image, final int x, final int y, final int width, final int height,
                                final int color) {
    for (int i = 0; i < width; i++) {
      set(image, x + i, y, color);
      set(image, x + i, y + height - 1, color);
    }
    for (int j = 0; j < height; j++) {
      set(image, x, y + j, color);
      set(image, x + width - 1, y + j, color);
    }
  }

  private static void set(final BufferedImage image, final int x, final int y, final int color) {
    if (x >= 0 && y >= 0 && x < image.getWidth() && y < image.getHeight()) {
      image.setRGB(x, y, color);
    }
  }
}

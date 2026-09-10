package dev.menuforge.state;

import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.Slot;
import dev.menuforge.model.SlotKind;
import dev.menuforge.model.StateDefinition;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Calculs de pagination des slots {@code list}.
 *
 * <p>Les cellules d’une liste sont celles de tous les slots {@code list} qui la
 * référencent, dans l’ordre des slots, chaque zone étant parcourue ligne par
 * ligne. La capacité d’une page est le nombre de ces cellules.
 */
public final class Pagination {

  private Pagination() {
  }

  /** Cellules (index d’inventaire) de la liste {@code list}, dans l’ordre de remplissage. */
  public static List<Integer> cells(final MenuDefinition menu, final String list) {
    final List<Integer> cells = new ArrayList<>();
    for (final Slot slot : menu.slots()) {
      if (slot.kind() == SlotKind.LIST && list.equals(slot.list())) {
        cells.addAll(slot.area().slotIndices());
      }
    }
    return cells;
  }

  /** Nombre de pages pour {@code entries} entrées et une capacité donnée (au moins 1). */
  public static int pageCount(final int entries, final int capacity) {
    if (capacity <= 0 || entries <= 0) {
      return 1;
    }
    return (entries + capacity - 1) / capacity;
  }

  /** Index de la première entrée affichée sur la page {@code page} (1-based). */
  public static int firstIndex(final int page, final int capacity) {
    return Math.max(0, (page - 1) * capacity);
  }

  /**
   * Nom de l’état {@code page} qui pagine la liste {@code list}, ou {@code null}.
   * Une action {@code nextPage} peut aussi désigner directement le nom de l’état.
   */
  public static String pageStateFor(final MenuDefinition menu, final String list) {
    for (final Map.Entry<String, StateDefinition> entry : menu.state().entrySet()) {
      if (entry.getValue() instanceof StateDefinition.PageState page && page.list().equals(list)) {
        return entry.getKey();
      }
    }
    if (menu.state().get(list) instanceof StateDefinition.PageState) {
      return list;
    }
    return null;
  }
}

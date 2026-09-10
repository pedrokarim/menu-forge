package dev.menuforge.parse;

import dev.menuforge.model.Action;
import dev.menuforge.model.Condition;
import dev.menuforge.model.Identified;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.Slot;
import dev.menuforge.model.SlotKind;
import dev.menuforge.model.StateDefinition;
import dev.menuforge.model.TextElement;
import dev.menuforge.render.TitleComposer;
import dev.menuforge.state.Pagination;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Vérifie la cohérence d’un menu <b>résolu</b> (après {@code extends}) : ce que
 * le parseur ne peut pas voir fichier par fichier.
 */
public final class MenuValidator {

  /** Hauteur de la police de texte (celle d’{@code ascii.png}). */
  public static final int TEXT_HEIGHT = 8;

  private MenuValidator() {
  }

  /**
   * Lève une {@link MenuValidationException} si le menu a au moins un problème.
   */
  public static void validate(final MenuDefinition menu) {
    final List<String> problems = problems(menu);
    if (!problems.isEmpty()) {
      throw new MenuValidationException(menu.id(), problems);
    }
  }

  /** Liste des problèmes (vide si le menu est cohérent). */
  public static List<String> problems(final MenuDefinition menu) {
    final List<String> problems = new ArrayList<>();
    final int rows = menu.effectiveContainer().rows();

    checkUniqueIds("couche", menu.layers(), problems);
    checkUniqueIds("texte", menu.texts(), problems);
    checkUniqueIds("slot", menu.slots(), problems);

    for (final Layer layer : menu.layers()) {
      checkCondition("couche « " + layer.id() + " »", layer.visibleWhen(), menu, problems);
    }

    for (final TextElement text : menu.texts()) {
      final int ascent = TitleComposer.TITLE_Y + 7 - text.y();
      if (ascent > TEXT_HEIGHT) {
        problems.add("texte « " + text.id() + " » : y = " + text.y() + " donne ascent = " + ascent
          + " > " + TEXT_HEIGHT + " (Minecraft refuse la police ; y doit valoir au moins 5)");
      }
      checkCondition("texte « " + text.id() + " »", text.visibleWhen(), menu, problems);
    }

    for (final Slot slot : menu.slots()) {
      final String label = "slot « " + slot.id() + " »";
      if (!slot.area().fitsIn(rows)) {
        problems.add(label + " : la zone sort du coffre de " + rows + " ligne(s)");
      }
      if (slot.kind() == SlotKind.LIST && (slot.list() == null || slot.list().isBlank())) {
        problems.add(label + " : un slot « list » doit nommer sa source de données");
      }
      checkCondition(label + " (visibleWhen)", slot.visibleWhen(), menu, problems);
      checkCondition(label + " (enabledWhen)", slot.enabledWhen(), menu, problems);
      for (final Action action : slot.onClick()) {
        checkAction(label, action, menu, problems);
      }
    }
    return problems;
  }

  private static void checkUniqueIds(final String kind, final List<? extends Identified> elements,
                                     final List<String> problems) {
    final Set<String> seen = new HashSet<>();
    for (final Identified element : elements) {
      if (!seen.add(element.id())) {
        problems.add(kind + " « " + element.id() + " » : id en double");
      }
    }
  }

  private static void checkCondition(final String label, final Condition condition, final MenuDefinition menu,
                                     final List<String> problems) {
    if (condition == null) {
      return;
    }
    condition.visit(node -> {
      final String state;
      if (node instanceof Condition.Is is) {
        state = is.state();
      } else if (node instanceof Condition.In in) {
        state = in.state();
      } else {
        state = null;
      }
      if (state != null && !menu.state().containsKey(state)) {
        problems.add(label + " : la condition porte sur l’état inconnu « " + state + " »");
      }
    });
  }

  private static void checkAction(final String label, final Action action, final MenuDefinition menu,
                                  final List<String> problems) {
    if (action instanceof Action.SetState setState) {
      final StateDefinition definition = menu.state().get(setState.state());
      if (definition == null) {
        problems.add(label + " : setState vise l’état inconnu « " + setState.state() + " »");
      } else {
        try {
          definition.coerce(setState.value());
        } catch (final IllegalArgumentException exception) {
          problems.add(label + " : setState « " + setState.state() + " » : " + exception.getMessage());
        }
      }
    } else if (action instanceof Action.NextPage next) {
      checkPageList(label, "nextPage", next.list(), menu, problems);
    } else if (action instanceof Action.PrevPage previous) {
      checkPageList(label, "prevPage", previous.list(), menu, problems);
    }
  }

  private static void checkPageList(final String label, final String type, final String list,
                                    final MenuDefinition menu, final List<String> problems) {
    if (Pagination.pageStateFor(menu, list) == null) {
      problems.add(label + " : " + type + " vise la liste « " + list + " », qu’aucun état « page » ne pagine");
    }
  }
}

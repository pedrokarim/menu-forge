package dev.menuforge.paper.api;

import dev.menuforge.model.Action;
import org.bukkit.inventory.ItemStack;

import java.util.List;
import java.util.Objects;
import java.util.function.Consumer;

/**
 * Une entrée d’une liste : l’item affiché et ce qui se passe au clic.
 *
 * <p>Au clic, la lib exécute d’abord les actions {@code onClick} du slot
 * {@code list}, puis {@code onClick} de l’entrée (code Java), puis ses
 * {@code actions} (actions du format).
 *
 * @param item    item affiché
 * @param actions actions du format exécutées au clic
 * @param onClick traitement Java au clic, ou {@code null}
 */
public record ListEntry(ItemStack item, List<Action> actions, Consumer<ActionContext> onClick) {

  public ListEntry {
    Objects.requireNonNull(item, "item");
    actions = List.copyOf(actions == null ? List.of() : actions);
  }

  /** Entrée purement décorative. */
  public static ListEntry of(final ItemStack item) {
    return new ListEntry(item, List.of(), null);
  }

  /** Entrée qui exécute des actions du format. */
  public static ListEntry of(final ItemStack item, final List<Action> actions) {
    return new ListEntry(item, actions, null);
  }

  /** Entrée qui exécute du code Java. */
  public static ListEntry of(final ItemStack item, final Consumer<ActionContext> onClick) {
    return new ListEntry(item, List.of(), onClick);
  }
}

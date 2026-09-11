package dev.menuforge.paper.internal;

import dev.menuforge.model.SlotKind;
import dev.menuforge.state.StateSnapshot;
import dev.menuforge.text.VariableResolver;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Porteur d’un inventaire MenuForge : permet de reconnaître nos coffres dans
 * les événements, et garde ce qui a servi à les construire.
 */
public final class MenuHolder implements InventoryHolder {

  private final MenuSessionImpl session;
  private final MenuSessionImpl.Frame frame;
  private final StateSnapshot snapshot;
  private final VariableResolver variables;
  private final Map<Integer, SlotBinding> bindings;
  private final String titleJson;
  private Inventory inventory;

  MenuHolder(final MenuSessionImpl session, final MenuSessionImpl.Frame frame, final StateSnapshot snapshot,
             final VariableResolver variables, final Map<Integer, SlotBinding> bindings, final String titleJson) {
    this.session = session;
    this.frame = frame;
    this.snapshot = snapshot;
    this.variables = variables;
    this.bindings = bindings;
    this.titleJson = titleJson;
  }

  /**
   * Porteur MenuForge d’un inventaire, ou {@code null}. Passe par
   * {@code getHolder(false)} de Paper (pas d’instantané de bloc pour les
   * coffres posés, l’écouteur voit passer tous les clics du serveur) ; retombe
   * sur {@code getHolder()} là où cette variante n’existe pas (serveur simulé
   * des tests). Pour notre propre porteur, les deux renvoient le même objet.
   */
  static MenuHolder of(final Inventory inventory) {
    if (inventory == null) {
      return null;
    }
    InventoryHolder holder;
    try {
      holder = inventory.getHolder(false);
    } catch (final RuntimeException notSupported) {
      // Paper ne lève jamais ici ; le serveur simulé lève une exception à lui.
      holder = inventory.getHolder();
    }
    return holder instanceof MenuHolder menuHolder ? menuHolder : null;
  }

  /** Titre du coffre, en composant texte JSON (tel qu’envoyé au client). */
  String titleJson() {
    return titleJson;
  }

  void attach(final Inventory inventory) {
    this.inventory = inventory;
  }

  @Override
  public Inventory getInventory() {
    return inventory;
  }

  MenuSessionImpl session() {
    return session;
  }

  MenuSessionImpl.Frame frame() {
    return frame;
  }

  String menuId() {
    return frame.menu().menu().id();
  }

  StateSnapshot snapshot() {
    return snapshot;
  }

  VariableResolver variables() {
    return variables;
  }

  SlotBinding binding(final int slot) {
    return bindings.get(slot);
  }

  /** Le slot accepte-t-il les manipulations du joueur ? */
  boolean isOpenInput(final int slot) {
    final SlotBinding binding = bindings.get(slot);
    return binding != null && binding.slot().kind() == SlotKind.INPUT && binding.enabled();
  }

  /** Slots {@code input} (actifs ou non), dans l’ordre de l’inventaire. */
  List<Integer> inputSlots() {
    return bindings.entrySet().stream()
      .filter(entry -> entry.getValue().slot().kind() == SlotKind.INPUT)
      .map(Map.Entry::getKey)
      .sorted()
      .collect(Collectors.toList());
  }
}

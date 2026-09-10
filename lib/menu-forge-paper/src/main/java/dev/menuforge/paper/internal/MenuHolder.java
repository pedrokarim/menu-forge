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
  private Inventory inventory;

  MenuHolder(final MenuSessionImpl session, final MenuSessionImpl.Frame frame, final StateSnapshot snapshot,
             final VariableResolver variables, final Map<Integer, SlotBinding> bindings) {
    this.session = session;
    this.frame = frame;
    this.snapshot = snapshot;
    this.variables = variables;
    this.bindings = bindings;
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

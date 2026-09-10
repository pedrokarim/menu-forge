package dev.menuforge.paper.internal;

import dev.menuforge.model.StateDefinition;
import dev.menuforge.paper.api.ActionContext;
import dev.menuforge.paper.api.MenuSession;
import dev.menuforge.render.CompiledMenu;
import dev.menuforge.state.Pagination;
import dev.menuforge.state.StateSnapshot;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryView;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.logging.Level;

/**
 * Session de menus d’un joueur : pile de menus, état, reconstruction.
 *
 * <p>Minecraft ne permet pas de changer le titre d’un inventaire ouvert : tout
 * changement d’état reconstruit le coffre et le rouvre. Pendant cette
 * transition ({@link #transitioning}), la fermeture de l’ancien coffre n’est
 * pas une vraie fermeture. Les items des slots {@code input} suivent le coffre
 * reconstruit ; ils sont rendus au joueur quand il quitte ce menu.
 */
final class MenuSessionImpl implements MenuSession {

  /** Un menu de la pile et son état. */
  static final class Frame {
    private final CompiledMenu menu;
    private final Map<String, Object> state;

    Frame(final CompiledMenu menu, final Map<String, Object> state) {
      this.menu = menu;
      this.state = new LinkedHashMap<>(state);
    }

    CompiledMenu menu() {
      return menu;
    }

    Map<String, Object> state() {
      return state;
    }
  }

  private final MenuForgeService service;
  private final Player player;
  private final Deque<Frame> stack = new ArrayDeque<>();
  private MenuHolder view;
  private boolean transitioning;
  private boolean ended;
  private int batchDepth;
  private boolean dirty;

  MenuSessionImpl(final MenuForgeService service, final Player player) {
    this.service = service;
    this.player = player;
  }

  // --- API -------------------------------------------------------------------

  @Override
  public Player player() {
    return player;
  }

  @Override
  public String menuId() {
    final Frame frame = stack.peek();
    return ended || frame == null ? null : frame.menu().menu().id();
  }

  @Override
  public Map<String, Object> state() {
    final Frame frame = stack.peek();
    return frame == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(frame.state()));
  }

  @Override
  public int depth() {
    return ended ? 0 : stack.size();
  }

  @Override
  public void open(final String menuId, final Map<String, Object> initialState) {
    final CompiledMenu compiled = service.compiled(menuId)
      .orElseThrow(() -> new IllegalArgumentException("menu inconnu : « " + menuId + " »"));
    final Map<String, Object> values = StateSnapshot.initialValues(compiled.menu().state(), initialState);
    if (ended) {
      ended = false;
      stack.clear();
      service.sessions().put(this);
    }
    releaseInputs(view);
    stack.push(new Frame(compiled, values));
    dirty = false;
    show(false);
  }

  @Override
  public void back() {
    if (ended) {
      return;
    }
    if (stack.size() <= 1) {
      close();
      return;
    }
    releaseInputs(view);
    stack.pop();
    dirty = false;
    show(false);
  }

  @Override
  public void close() {
    if (ended) {
      return;
    }
    if (isViewOpen()) {
      player.closeInventory();
    }
    if (!ended) {
      releaseInputs(view);
      end();
    }
  }

  @Override
  public void setState(final String name, final Object value) {
    final Frame frame = current();
    final StateDefinition definition = frame.menu().menu().state().get(name);
    if (definition == null) {
      throw new IllegalArgumentException("état inconnu : « " + name + " »");
    }
    frame.state().put(name, definition.coerce(value));
    refresh();
  }

  @Override
  public void refresh() {
    if (ended || stack.isEmpty()) {
      return;
    }
    if (batchDepth > 0) {
      dirty = true;
    } else {
      show(true);
    }
  }

  // --- Interne -----------------------------------------------------------------

  /** Change de page dans la liste {@code list} ({@code delta} = ±1). */
  void changePage(final String list, final int delta) {
    final Frame frame = current();
    final String stateName = Pagination.pageStateFor(frame.menu().menu(), list);
    if (stateName == null) {
      service.logger().warning("menu « " + menuId() + " » : aucun état « page » ne pagine la liste « " + list + " »");
      return;
    }
    final int count = view != null && view.frame() == frame ? view.snapshot().pageCount(stateName) : 1;
    final Object raw = frame.state().get(stateName);
    final int currentPage = raw instanceof Number number ? number.intValue() : 1;
    final int next = Math.max(1, Math.min(count, currentPage + delta));
    if (next != currentPage) {
      frame.state().put(stateName, next);
      refresh();
    }
  }

  /** Exécute un clic sur un slot actif (au tick suivant, hors de l’événement d’inventaire). */
  void handleClick(final MenuHolder holder, final SlotBinding binding, final ClickType click) {
    Bukkit.getScheduler().runTask(service.plugin(), () -> {
      if (ended || view != holder) {
        return;
      }
      final ActionContext context = new ActionContext(player, this, holder.menuId(), binding.slot().id(), click);
      runBatch(() -> {
        service.actionExecutor().execute(context, holder, binding.slot().onClick());
        if (binding.entry() != null) {
          if (binding.entry().onClick() != null) {
            try {
              binding.entry().onClick().accept(context);
            } catch (final RuntimeException exception) {
              service.logger().log(Level.WARNING, "clic sur une entrée de liste en erreur", exception);
            }
          }
          service.actionExecutor().execute(context, holder, binding.entry().actions());
        }
      });
    });
  }

  /** Exécute {@code actions} en ne reconstruisant le menu qu’une fois à la fin. */
  void runBatch(final Runnable actions) {
    batchDepth++;
    try {
      actions.run();
    } finally {
      batchDepth--;
      if (batchDepth == 0 && dirty && !ended) {
        dirty = false;
        show(true);
      }
    }
  }

  /** Appelé par l’écouteur quand un de nos coffres se ferme. */
  void onClosed(final MenuHolder holder) {
    if (transitioning || ended || holder != view) {
      return;
    }
    releaseInputs(holder);
    end();
  }

  /** Fermeture imposée (rechargement, arrêt). */
  void forceClose() {
    if (ended) {
      return;
    }
    releaseInputs(view);
    final boolean open = isViewOpen();
    end();
    if (open) {
      player.closeInventory();
    }
  }

  private Frame current() {
    final Frame frame = stack.peek();
    if (frame == null || ended) {
      throw new IllegalStateException("aucun menu ouvert");
    }
    return frame;
  }

  private boolean isViewOpen() {
    return view != null && player.getOpenInventory().getTopInventory().getHolder(false) == view;
  }

  private void show(final boolean keepInputs) {
    final Frame frame = current();
    final MenuHolder previous = view;
    final MenuHolder next;
    try {
      next = MenuViewBuilder.build(service, this, frame);
    } catch (final RuntimeException exception) {
      service.logger().log(Level.SEVERE, "construction du menu « " + frame.menu().menu().id() + " » impossible", exception);
      forceClose();
      return;
    }
    if (previous != null) {
      if (keepInputs && previous.frame() == frame) {
        transferInputs(previous, next);
      } else {
        releaseInputs(previous);
      }
    }
    view = next;
    transitioning = true;
    final InventoryView opened;
    try {
      opened = player.openInventory(next.getInventory());
    } finally {
      transitioning = false;
    }
    if (opened == null) {
      // Ouverture refusée par un autre plugin : on abandonne proprement.
      releaseInputs(next);
      end();
    }
  }

  private void transferInputs(final MenuHolder from, final MenuHolder to) {
    final Inventory source = from.getInventory();
    final Inventory target = to.getInventory();
    for (final int slot : from.inputSlots()) {
      final ItemStack item = source.getItem(slot);
      if (item == null || item.getType().isAir()) {
        continue;
      }
      source.setItem(slot, null);
      if (to.binding(slot) != null && to.inputSlots().contains(slot) && isEmpty(target.getItem(slot))) {
        target.setItem(slot, item);
      } else {
        give(item);
      }
    }
  }

  private void releaseInputs(final MenuHolder holder) {
    if (holder == null || holder.getInventory() == null) {
      return;
    }
    final Inventory inventory = holder.getInventory();
    for (final int slot : holder.inputSlots()) {
      final ItemStack item = inventory.getItem(slot);
      if (!isEmpty(item)) {
        inventory.setItem(slot, null);
        give(item);
      }
    }
  }

  private void give(final ItemStack item) {
    final Map<Integer, ItemStack> leftovers = player.getInventory().addItem(item);
    for (final ItemStack leftover : new ArrayList<>(leftovers.values())) {
      player.getWorld().dropItemNaturally(player.getLocation(), leftover);
    }
  }

  private static boolean isEmpty(final ItemStack item) {
    return item == null || item.getType().isAir() || item.getAmount() <= 0;
  }

  private void end() {
    ended = true;
    stack.clear();
    view = null;
    dirty = false;
    service.sessions().remove(player.getUniqueId(), this);
  }
}

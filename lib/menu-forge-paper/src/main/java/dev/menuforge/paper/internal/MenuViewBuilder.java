package dev.menuforge.paper.internal;

import dev.menuforge.model.Condition;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.Slot;
import dev.menuforge.model.SlotKind;
import dev.menuforge.model.StateDefinition;
import dev.menuforge.model.TextElement;
import dev.menuforge.paper.api.ListEntry;
import dev.menuforge.paper.api.ListProvider;
import dev.menuforge.paper.api.ListRequest;
import dev.menuforge.state.ConditionContext;
import dev.menuforge.state.Pagination;
import dev.menuforge.state.StateSnapshot;
import dev.menuforge.text.VariableResolver;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.logging.Level;

/**
 * Construit le coffre d’un menu pour un joueur : listes, état, drapeaux,
 * titre, puis slots.
 */
final class MenuViewBuilder {

  private MenuViewBuilder() {
  }

  static MenuHolder build(final MenuForgeService service, final MenuSessionImpl session,
                          final MenuSessionImpl.Frame frame) {
    final Player player = session.player();
    final MenuDefinition menu = frame.menu().menu();

    // 1. Listes : entrées et nombre de pages (nécessaires aux drapeaux de page).
    final Map<String, List<ListEntry>> lists = new LinkedHashMap<>();
    final Map<String, Integer> pageCounts = new HashMap<>();
    for (final Slot slot : menu.slots()) {
      if (slot.kind() != SlotKind.LIST || lists.containsKey(slot.list())) {
        continue;
      }
      final List<ListEntry> entries = fetch(service, player, menu, slot.list(), frame.state());
      lists.put(slot.list(), entries);
      final String pageState = Pagination.pageStateFor(menu, slot.list());
      if (pageState != null) {
        pageCounts.put(pageState, Pagination.pageCount(entries.size(), Pagination.cells(menu, slot.list()).size()));
      }
    }

    // 2. État effectif (pages ramenées dans leurs bornes) et drapeaux.
    final StateSnapshot snapshot = StateSnapshot.of(menu.state(), frame.state(), pageCounts);
    menu.state().forEach((name, definition) -> {
      if (definition instanceof StateDefinition.PageState) {
        frame.state().put(name, snapshot.values().get(name));
      }
    });
    final Set<String> serverFlags = new LinkedHashSet<>();
    for (final String flag : referencedFlags(menu)) {
      if (!snapshot.flags().contains(flag) && !isPageFlag(menu, flag) && service.flag(player, flag)) {
        serverFlags.add(flag);
      }
    }
    final ConditionContext context = snapshot.context(serverFlags);

    // 3. Variables : état, joueur, puis serveur.
    final VariableResolver variables = snapshot.asResolver()
      .or(name -> viewerVariable(player, name))
      .or(name -> service.placeholder(player, name));

    // 4. Titre.
    final String titleJson = frame.menu().titleJson(service.titleRenderer(), context, variables);
    final Component title = GsonComponentSerializer.gson().deserialize(titleJson);

    // 5. Slots.
    final Map<Integer, SlotBinding> bindings = new HashMap<>();
    final MenuHolder holder = new MenuHolder(session, frame, snapshot, variables, bindings, titleJson);
    final Inventory inventory = service.inventoryFactory().create(holder, menu.effectiveContainer().size(), title);
    holder.attach(inventory);

    final Map<String, Integer> listPositions = new HashMap<>();
    for (final Slot slot : menu.slots()) {
      final boolean visible = slot.isVisible(context);
      final boolean enabled = slot.isEnabled(context);
      if (slot.kind() == SlotKind.LIST) {
        fillList(slot, visible, enabled, lists.get(slot.list()), snapshot, menu, listPositions, inventory, bindings);
        continue;
      }
      if (!visible) {
        continue;
      }
      final ItemStack item = slot.kind() == SlotKind.INPUT ? null
        : service.itemRenderer().render(slot.item(), player, variables);
      for (final int index : slot.area().slotIndices()) {
        inventory.setItem(index, item == null ? null : item.clone());
        bindings.put(index, new SlotBinding(slot, enabled, null));
      }
    }
    return holder;
  }

  private static void fillList(final Slot slot, final boolean visible, final boolean enabled,
                               final List<ListEntry> entries, final StateSnapshot snapshot, final MenuDefinition menu,
                               final Map<String, Integer> listPositions, final Inventory inventory,
                               final Map<Integer, SlotBinding> bindings) {
    final String list = slot.list();
    final int capacity = Pagination.cells(menu, list).size();
    final String pageState = Pagination.pageStateFor(menu, list);
    final int page = pageState == null ? 1 : ((Number) snapshot.values().get(pageState)).intValue();
    final int first = Pagination.firstIndex(page, capacity);
    // La position dans la liste compte aussi les slots invisibles : la pagination reste stable.
    int position = listPositions.getOrDefault(list, 0);
    for (final int index : slot.area().slotIndices()) {
      final int entryIndex = first + position;
      position++;
      if (!visible) {
        continue;
      }
      final ListEntry entry = entries != null && entryIndex < entries.size() ? entries.get(entryIndex) : null;
      inventory.setItem(index, entry == null ? null : entry.item().clone());
      bindings.put(index, new SlotBinding(slot, enabled, entry));
    }
    listPositions.put(list, position);
  }

  private static List<ListEntry> fetch(final MenuForgeService service, final Player player, final MenuDefinition menu,
                                       final String list, final Map<String, Object> state) {
    final ListProvider provider = service.listProvider(list);
    if (provider == null) {
      return List.of();
    }
    try {
      final List<ListEntry> entries = provider.entries(new ListRequest(player, menu.id(), list, state));
      return entries == null ? List.of() : entries;
    } catch (final RuntimeException exception) {
      service.logger().log(Level.WARNING, "source de données « " + list + " » en erreur", exception);
      return List.of();
    }
  }

  private static String viewerVariable(final Player player, final String name) {
    switch (name) {
      case "viewer":
      case "viewer.name":
        return player.getName();
      case "viewer.uuid":
        return player.getUniqueId().toString();
      default:
        return null;
    }
  }

  private static boolean isPageFlag(final MenuDefinition menu, final String flag) {
    final int dot = flag.lastIndexOf('.');
    if (dot <= 0) {
      return false;
    }
    final String suffix = flag.substring(dot + 1);
    return ("hasPrev".equals(suffix) || "hasNext".equals(suffix))
      && menu.state().get(flag.substring(0, dot)) instanceof StateDefinition.PageState;
  }

  private static Set<String> referencedFlags(final MenuDefinition menu) {
    final Set<String> flags = new LinkedHashSet<>();
    for (final Layer layer : menu.layers()) {
      collect(layer.visibleWhen(), flags);
    }
    for (final TextElement text : menu.texts()) {
      collect(text.visibleWhen(), flags);
    }
    for (final Slot slot : menu.slots()) {
      collect(slot.visibleWhen(), flags);
      collect(slot.enabledWhen(), flags);
    }
    return flags;
  }

  private static void collect(final Condition condition, final Set<String> flags) {
    if (condition != null) {
      flags.addAll(condition.referencedFlags());
    }
  }
}

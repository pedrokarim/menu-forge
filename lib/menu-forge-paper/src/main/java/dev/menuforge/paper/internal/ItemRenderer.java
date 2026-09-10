package dev.menuforge.paper.internal;

import dev.menuforge.model.ItemSpec;
import dev.menuforge.text.VariableResolver;
import dev.menuforge.text.Variables;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.SkullMeta;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Transforme un {@link ItemSpec} du format en {@link ItemStack}. */
final class ItemRenderer {

  private final MenuForgeService service;
  private final Set<String> warned = ConcurrentHashMap.newKeySet();

  ItemRenderer(final MenuForgeService service) {
    this.service = service;
  }

  /** Item à afficher, ou {@code null} si la spec est absente. */
  ItemStack render(final ItemSpec spec, final Player viewer, final VariableResolver variables) {
    if (spec == null) {
      return null;
    }
    ItemStack item = null;
    if (spec.ref() != null) {
      item = service.itemFactory().create(spec.ref(), viewer);
      if (item == null) {
        warnOnce("ref:" + spec.ref(), "référence d’item inconnue « " + spec.ref() + " » : item invisible utilisé");
      }
    } else if (!spec.invisible() && spec.material() != null) {
      final Material material = Material.matchMaterial(spec.material());
      if (material == null || !material.isItem()) {
        warnOnce("material:" + spec.material(), "matériau inconnu « " + spec.material() + " » : BARRIER utilisé");
        item = new ItemStack(Material.BARRIER);
      } else {
        item = new ItemStack(material);
      }
    }
    if (item == null) {
      item = service.itemFactory().invisible(viewer);
      if (item == null) {
        item = service.defaultItemFactory().invisible(viewer);
      }
    }
    item = item.clone();

    final ItemMeta meta = item.getItemMeta();
    if (meta == null) {
      return item;
    }
    if (spec.head() != null && meta instanceof SkullMeta skull) {
      applyHead(skull, Variables.interpolate(spec.head(), variables), viewer);
    }
    if (spec.name() != null) {
      meta.displayName(text(Variables.interpolate(spec.name(), variables)));
    }
    if (!spec.lore().isEmpty()) {
      final List<Component> lore = new ArrayList<>();
      for (final String line : spec.lore()) {
        lore.add(text(Variables.interpolate(line, variables)));
      }
      meta.lore(lore);
    }
    if (spec.invisible() && spec.name() == null && spec.lore().isEmpty()) {
      meta.setHideTooltip(true);
    }
    item.setItemMeta(meta);
    return item;
  }

  private static Component text(final String miniMessage) {
    return MiniMessage.miniMessage().deserialize(miniMessage)
      .decorationIfAbsent(TextDecoration.ITALIC, TextDecoration.State.FALSE);
  }

  private static void applyHead(final SkullMeta skull, final String owner, final Player viewer) {
    if (owner.equalsIgnoreCase(viewer.getName())) {
      skull.setOwningPlayer(viewer);
      return;
    }
    final Player online = Bukkit.getPlayerExact(owner);
    if (online != null) {
      skull.setOwningPlayer(online);
      return;
    }
    try {
      skull.setOwningPlayer(Bukkit.getOfflinePlayer(UUID.fromString(owner)));
      return;
    } catch (final IllegalArgumentException notAUuid) {
      // Pas un UUID : on tente le cache des joueurs connus, sans requête réseau.
    }
    final OfflinePlayer cached = Bukkit.getOfflinePlayerIfCached(owner);
    if (cached != null) {
      skull.setOwningPlayer(cached);
    }
  }

  private void warnOnce(final String key, final String message) {
    if (warned.add(key)) {
      service.logger().warning(message);
    }
  }
}

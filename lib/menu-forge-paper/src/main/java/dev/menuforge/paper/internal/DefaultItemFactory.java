package dev.menuforge.paper.internal;

import dev.menuforge.paper.api.ItemFactory;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.logging.Logger;

/**
 * Fabrique par défaut.
 *
 * <ul>
 *   <li>item invisible : le matériau configuré (défaut {@code PAPER}), avec le
 *       modèle d’item ({@code item_model}) configuré, sinon le
 *       {@code CustomModelData} configuré, sinon tel quel ; son infobulle est
 *       masquée s’il n’a ni nom ni description ;</li>
 *   <li>{@code ref} : un matériau vanilla ({@code minecraft:stone}), sinon inconnu.</li>
 * </ul>
 */
final class DefaultItemFactory implements ItemFactory {

  private final Material material;
  private final NamespacedKey itemModel;
  private final int customModelData;

  DefaultItemFactory(final Material material, final NamespacedKey itemModel, final int customModelData) {
    this.material = material;
    this.itemModel = itemModel;
    this.customModelData = customModelData;
  }

  static DefaultItemFactory fromConfig(final FileConfiguration config, final Logger logger) {
    final String materialName = config.getString("invisible-item.material", "PAPER");
    Material material = Material.matchMaterial(materialName == null ? "PAPER" : materialName);
    if (material == null || !material.isItem() || material.isAir()) {
      logger.warning("invisible-item.material invalide (« " + materialName + " »), PAPER utilisé");
      material = Material.PAPER;
    }
    final String modelName = config.getString("invisible-item.item-model", "");
    NamespacedKey model = null;
    if (modelName != null && !modelName.isBlank()) {
      model = MenuForgeService.parseKey(modelName);
      if (model == null) {
        logger.warning("invisible-item.item-model invalide (« " + modelName + " »), ignoré");
      }
    }
    return new DefaultItemFactory(material, model, config.getInt("invisible-item.custom-model-data", 0));
  }

  @Override
  public ItemStack create(final String ref, final Player viewer) {
    final Material vanilla = Material.matchMaterial(ref);
    return vanilla != null && vanilla.isItem() && !vanilla.isAir() ? new ItemStack(vanilla) : null;
  }

  @Override
  @SuppressWarnings("deprecation")
  public ItemStack invisible(final Player viewer) {
    final ItemStack item = new ItemStack(material);
    final ItemMeta meta = item.getItemMeta();
    if (meta != null) {
      if (itemModel != null) {
        meta.setItemModel(itemModel);
      } else if (customModelData != 0) {
        meta.setCustomModelData(customModelData);
      }
      item.setItemMeta(meta);
    }
    return item;
  }
}

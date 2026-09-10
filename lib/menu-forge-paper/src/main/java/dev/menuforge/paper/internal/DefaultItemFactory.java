package dev.menuforge.paper.internal;

import dev.menuforge.paper.api.ItemFactory;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.lang.reflect.Method;
import java.util.logging.Logger;

/**
 * Fabrique par défaut.
 *
 * <ul>
 *   <li>item invisible : le matériau configuré (défaut {@code PAPER}), avec le
 *       modèle d’item ({@code item_model}) configuré s’il est pris en charge
 *       (1.21.4+), sinon le {@code CustomModelData} configuré, sinon tel quel ;
 *       son infobulle est masquée s’il n’a ni nom ni description ;</li>
 *   <li>{@code ref} : un matériau vanilla ({@code minecraft:stone}), sinon inconnu.</li>
 * </ul>
 */
final class DefaultItemFactory implements ItemFactory {

  /** {@code ItemMeta#setItemModel} n’existe qu’à partir de 1.21.4 : appel par réflexion. */
  private static final Method SET_ITEM_MODEL = findSetItemModel();

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
      } else if (SET_ITEM_MODEL == null) {
        logger.warning("invisible-item.item-model demande Minecraft 1.21.4+ ; ignoré, custom-model-data utilisé");
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
      if (!applyItemModel(meta) && customModelData != 0) {
        meta.setCustomModelData(customModelData);
      }
      item.setItemMeta(meta);
    }
    return item;
  }

  /** Applique le modèle d’item configuré ; {@code false} s’il n’y en a pas ou si la version ne le permet pas. */
  private boolean applyItemModel(final ItemMeta meta) {
    if (itemModel == null || SET_ITEM_MODEL == null) {
      return false;
    }
    try {
      SET_ITEM_MODEL.invoke(meta, itemModel);
      return true;
    } catch (final ReflectiveOperationException exception) {
      return false;
    }
  }

  private static Method findSetItemModel() {
    try {
      return ItemMeta.class.getMethod("setItemModel", NamespacedKey.class);
    } catch (final NoSuchMethodException exception) {
      return null;
    }
  }
}

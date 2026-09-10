package dev.menuforge.paper;

import dev.menuforge.paper.api.MenuForgeApi;
import dev.menuforge.paper.internal.MenuForgeCommand;
import dev.menuforge.paper.internal.MenuForgeService;
import dev.menuforge.paper.internal.MenuListener;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Plugin Paper autonome « MenuForge ».
 *
 * <p>Plugin séparé à dessein : un plugin qui shade et relocalise
 * {@code net.kyori} (comme Enderium) casse les appels Adventure natifs de
 * Paper ; ici, Adventure est celui de Paper, sans relocalisation.
 */
public final class MenuForgePlugin extends JavaPlugin {

  private MenuForgeService service;

  @Override
  public void onEnable() {
    saveDefaultConfig();
    service = new MenuForgeService(this);
    service.reloadWorkspace();

    getServer().getServicesManager().register(MenuForgeApi.class, service, this, ServicePriority.Normal);
    getServer().getPluginManager().registerEvents(new MenuListener(service), this);

    final PluginCommand command = getCommand("menuforge");
    if (command != null) {
      final MenuForgeCommand executor = new MenuForgeCommand(service);
      command.setExecutor(executor);
      command.setTabCompleter(executor);
    }
  }

  @Override
  public void onDisable() {
    if (service != null) {
      service.shutdown();
    }
    getServer().getServicesManager().unregisterAll(this);
  }
}

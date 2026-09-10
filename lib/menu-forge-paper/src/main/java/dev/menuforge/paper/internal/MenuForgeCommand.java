package dev.menuforge.paper.internal;

import dev.menuforge.calibration.CalibrationMenu;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;

/**
 * {@code /menuforge open <menu> [joueur]}, {@code /menuforge reload},
 * {@code /menuforge calibrate [joueur]}.
 */
public final class MenuForgeCommand implements CommandExecutor, TabCompleter {

  private static final List<String> SUBCOMMANDS = List.of("open", "reload", "calibrate");

  private final MenuForgeService service;

  public MenuForgeCommand(final MenuForgeService service) {
    this.service = service;
  }

  @Override
  public boolean onCommand(final CommandSender sender, final Command command, final String label, final String[] args) {
    if (args.length == 0) {
      usage(sender, label);
      return true;
    }
    switch (args[0].toLowerCase(Locale.ROOT)) {
      case "open":
        if (args.length < 2) {
          error(sender, "Usage : /" + label + " open <menu> [joueur]");
          return true;
        }
        open(sender, args[1], args.length >= 3 ? args[2] : null);
        return true;
      case "calibrate":
        open(sender, CalibrationMenu.MENU_ID, args.length >= 2 ? args[1] : null);
        return true;
      case "reload": {
        final MenuForgeService.ReloadReport report = service.reloadWorkspace();
        info(sender, "MenuForge rechargé : " + report.menus() + " menu(s), " + report.files()
          + " fichier(s) de pack dans " + service.packDirectory() + ".");
        for (final String error : report.errors()) {
          error(sender, error);
        }
        if (!report.errors().isEmpty()) {
          error(sender, report.errors().size() + " erreur(s) : voir aussi la console.");
        }
        return true;
      }
      default:
        usage(sender, label);
        return true;
    }
  }

  private void open(final CommandSender sender, final String menuId, final String targetName) {
    final Player target;
    if (targetName != null) {
      target = Bukkit.getPlayerExact(targetName);
      if (target == null) {
        error(sender, "Joueur introuvable : " + targetName);
        return;
      }
    } else if (sender instanceof Player player) {
      target = player;
    } else {
      error(sender, "Précisez un joueur depuis la console.");
      return;
    }
    if (!service.menuIds().contains(menuId)) {
      error(sender, "Menu inconnu : « " + menuId + " ».");
      return;
    }
    try {
      service.open(target, menuId);
    } catch (final RuntimeException exception) {
      error(sender, "Ouverture impossible : " + exception.getMessage());
    }
  }

  @Override
  public List<String> onTabComplete(final CommandSender sender, final Command command, final String alias,
                                    final String[] args) {
    if (args.length == 1) {
      return filter(SUBCOMMANDS, args[0]);
    }
    final String sub = args[0].toLowerCase(Locale.ROOT);
    if ("open".equals(sub) && args.length == 2) {
      return filter(new ArrayList<>(service.menuIds()), args[1]);
    }
    if (("open".equals(sub) && args.length == 3) || ("calibrate".equals(sub) && args.length == 2)) {
      return filter(Bukkit.getOnlinePlayers().stream().map(Player::getName).collect(Collectors.toList()),
        args[args.length - 1]);
    }
    return List.of();
  }

  private static List<String> filter(final List<String> values, final String prefix) {
    final String lower = prefix.toLowerCase(Locale.ROOT);
    return values.stream().filter(value -> value.toLowerCase(Locale.ROOT).startsWith(lower)).sorted()
      .collect(Collectors.toList());
  }

  private static void usage(final CommandSender sender, final String label) {
    info(sender, "/" + label + " open <menu> [joueur] – ouvre un menu");
    info(sender, "/" + label + " reload – recharge les menus et régénère le pack");
    info(sender, "/" + label + " calibrate [joueur] – ouvre le menu de calibration");
  }

  private static void info(final CommandSender sender, final String message) {
    sender.sendMessage(Component.text(message, NamedTextColor.GRAY));
  }

  private static void error(final CommandSender sender, final String message) {
    sender.sendMessage(Component.text(message, NamedTextColor.RED));
  }
}

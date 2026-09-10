package dev.menuforge.paper.internal;

import dev.menuforge.model.Action;
import dev.menuforge.paper.api.ActionContext;
import dev.menuforge.paper.api.CustomActionHandler;
import dev.menuforge.text.Variables;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

import java.util.List;
import java.util.logging.Level;

/** Exécute les actions du format. Une action en erreur est journalisée sans bloquer les suivantes. */
final class ActionExecutor {

  private final MenuForgeService service;

  ActionExecutor(final MenuForgeService service) {
    this.service = service;
  }

  void execute(final ActionContext context, final MenuHolder holder, final List<Action> actions) {
    for (final Action action : actions) {
      try {
        run(context, holder, action);
      } catch (final RuntimeException exception) {
        service.logger().log(Level.WARNING, "action « " + action.type() + " » du menu « " + context.menuId()
          + " » (slot « " + context.slotId() + " ») en erreur : " + exception.getMessage(), exception);
      }
    }
  }

  private void run(final ActionContext context, final MenuHolder holder, final Action action) {
    final MenuSessionImpl session = holder.session();
    final Player player = context.player();
    if (action instanceof Action.Open open) {
      session.open(open.menu(), open.state());
    } else if (action instanceof Action.Back) {
      session.back();
    } else if (action instanceof Action.Close) {
      session.close();
    } else if (action instanceof Action.SetState setState) {
      if (session.menuId() != null) {
        session.setState(setState.state(), setState.value());
      }
    } else if (action instanceof Action.NextPage next) {
      if (session.menuId() != null) {
        session.changePage(next.list(), 1);
      }
    } else if (action instanceof Action.PrevPage previous) {
      if (session.menuId() != null) {
        session.changePage(previous.list(), -1);
      }
    } else if (action instanceof Action.Sound sound) {
      player.playSound(player.getLocation(), sound.sound(), sound.volume(), sound.pitch());
    } else if (action instanceof Action.Command command) {
      String line = Variables.interpolate(command.command(), holder.variables());
      if (line.startsWith("/")) {
        line = line.substring(1);
      }
      if (command.as() == Action.CommandSender.CONSOLE) {
        Bukkit.dispatchCommand(Bukkit.getConsoleSender(), line);
      } else {
        player.performCommand(line);
      }
    } else if (action instanceof Action.Custom custom) {
      final CustomActionHandler handler = service.customAction(custom.id());
      if (handler == null) {
        service.logger().warning("action custom « " + custom.id() + " » : aucun traitement enregistré");
      } else {
        handler.handle(context, custom.args());
      }
    }
  }
}

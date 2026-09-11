package dev.menuforge.paper.internal;

import be.seeseemelk.mockbukkit.command.ConsoleCommandSenderMock;
import be.seeseemelk.mockbukkit.entity.PlayerMock;
import dev.menuforge.calibration.CalibrationMenu;
import org.bukkit.command.PluginCommand;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** {@code /menuforge open | reload | calibrate} et leur complétion. */
class CommandTest extends MockServerTest {

  private ConsoleCommandSenderMock console;

  @BeforeEach
  void setUpMenus() {
    loadTestMenus();
    console = (ConsoleCommandSenderMock) server.getConsoleSender();
  }

  /** Messages reçus depuis le dernier appel. */
  private List<String> messages() {
    final List<String> messages = new ArrayList<>();
    String message;
    while ((message = console.nextMessage()) != null) {
      messages.add(message);
    }
    return messages;
  }

  @Test
  void openFromTheConsoleTargetsAPlayer() {
    final PlayerMock player = server.addPlayer();
    server.dispatchCommand(console, "menuforge open shop " + player.getName());
    assertNotNull(holder(player));
    assertEquals("shop", holder(player).menuId());
  }

  @Test
  void openReportsUnknownMenusAndPlayers() {
    messages();
    server.dispatchCommand(console, "menuforge open nope Personne");
    assertTrue(String.join("\n", messages()).contains("Joueur introuvable"));

    final PlayerMock player = server.addPlayer();
    server.dispatchCommand(console, "mf open nope " + player.getName());
    assertTrue(String.join("\n", messages()).contains("Menu inconnu"));
    assertNull(holder(player));

    server.dispatchCommand(console, "menuforge open shop");
    assertTrue(String.join("\n", messages()).contains("Précisez un joueur"));
  }

  @Test
  void calibrateOpensTheBuiltInMenu() {
    final PlayerMock player = server.addPlayer();
    server.dispatchCommand(console, "menuforge calibrate " + player.getName());
    assertEquals(CalibrationMenu.MENU_ID, holder(player).menuId());
  }

  @Test
  void reloadClosesOpenMenusAndReportsTheCount() {
    final PlayerMock player = server.addPlayer();
    service.open(player, "shop");
    messages();

    server.dispatchCommand(console, "menuforge reload");
    assertNull(holder(player), "les menus ouverts sont fermés");
    assertTrue(String.join("\n", messages()).contains("3 menu(s)"));
  }

  @Test
  void playersWithoutPermissionCannotUseIt() {
    final PlayerMock player = server.addPlayer();
    player.setOp(false);
    player.performCommand("menuforge open shop");
    assertNull(holder(player));
  }

  @Test
  void tabCompletionSuggestsSubcommandsMenusAndPlayers() {
    final PlayerMock player = server.addPlayer();
    final PluginCommand command = plugin.getCommand("menuforge");
    assertNotNull(command);
    final MenuForgeCommand executor = (MenuForgeCommand) command.getExecutor();

    assertEquals(List.of("open"), executor.onTabComplete(console, command, "mf", new String[] {"o"}));
    assertEquals(List.of("detail", "list", "menuforge_calibration", "shop"),
      executor.onTabComplete(console, command, "mf", new String[] {"open", ""}));
    assertEquals(List.of(player.getName()),
      executor.onTabComplete(console, command, "mf", new String[] {"calibrate", player.getName().substring(0, 3)}));
  }
}

package dev.menuforge.model;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Action déclenchée par un clic (voir {@code docs/format.md}, § Actions).
 *
 * <p>Les valeurs libres ({@code state}, {@code value}, {@code args}) sont des
 * objets Java simples : {@link String}, {@link Boolean}, {@link Long},
 * {@link Double}, {@link java.util.List} ou {@link Map}.
 */
public sealed interface Action {

  /** Type de l’action, tel qu’écrit dans le format. */
  String type();

  /** Ouvre un autre menu, empilé ({@code back} y revient). */
  record Open(String menu, Map<String, Object> state) implements Action {
    public Open {
      Objects.requireNonNull(menu, "menu");
      state = Collections.unmodifiableMap(new LinkedHashMap<>(state == null ? Map.of() : state));
    }

    @Override
    public String type() {
      return "open";
    }
  }

  /** Revient au menu précédent, ou ferme. */
  record Back() implements Action {
    @Override
    public String type() {
      return "back";
    }
  }

  /** Ferme l’inventaire. */
  record Close() implements Action {
    @Override
    public String type() {
      return "close";
    }
  }

  /** Change une variable d’état. */
  record SetState(String state, Object value) implements Action {
    public SetState {
      Objects.requireNonNull(state, "state");
    }

    @Override
    public String type() {
      return "setState";
    }
  }

  /** Passe à la page suivante de la liste {@code list}. */
  record NextPage(String list) implements Action {
    public NextPage {
      Objects.requireNonNull(list, "list");
    }

    @Override
    public String type() {
      return "nextPage";
    }
  }

  /** Revient à la page précédente de la liste {@code list}. */
  record PrevPage(String list) implements Action {
    public PrevPage {
      Objects.requireNonNull(list, "list");
    }

    @Override
    public String type() {
      return "prevPage";
    }
  }

  /** Joue un son au joueur. */
  record Sound(String sound, float volume, float pitch) implements Action {
    public Sound {
      Objects.requireNonNull(sound, "sound");
    }

    @Override
    public String type() {
      return "sound";
    }
  }

  /** Exécute une commande, en tant que joueur ou console. */
  record Command(String command, CommandSender as) implements Action {
    public Command {
      Objects.requireNonNull(command, "command");
      as = as == null ? CommandSender.PLAYER : as;
    }

    @Override
    public String type() {
      return "command";
    }
  }

  /** Action transmise à l’adaptateur du serveur, par {@code id}. */
  record Custom(String id, Map<String, Object> args) implements Action {
    public Custom {
      Objects.requireNonNull(id, "id");
      args = Collections.unmodifiableMap(new LinkedHashMap<>(args == null ? Map.of() : args));
    }

    @Override
    public String type() {
      return "custom";
    }
  }

  /** Qui exécute une action {@code command}. */
  enum CommandSender {
    PLAYER,
    CONSOLE
  }
}

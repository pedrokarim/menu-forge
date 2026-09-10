package dev.menuforge.paper.internal;

import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Sessions de menus, une par joueur ayant un menu ouvert. */
final class SessionManager {

  private final Map<UUID, MenuSessionImpl> sessions = new ConcurrentHashMap<>();

  MenuSessionImpl getOrCreate(final MenuForgeService service, final Player player) {
    return sessions.computeIfAbsent(player.getUniqueId(), id -> new MenuSessionImpl(service, player));
  }

  Optional<MenuSessionImpl> get(final UUID playerId) {
    return Optional.ofNullable(sessions.get(playerId));
  }

  /** Enregistre (à nouveau) une session. */
  void put(final MenuSessionImpl session) {
    sessions.put(session.player().getUniqueId(), session);
  }

  /** Retire la session si c’est bien celle-ci. */
  void remove(final UUID playerId, final MenuSessionImpl session) {
    sessions.remove(playerId, session);
  }

  /** Ferme tous les menus ouverts (items des slots {@code input} rendus). */
  void closeAll() {
    for (final MenuSessionImpl session : new ArrayList<>(sessions.values())) {
      session.forceClose();
    }
    sessions.clear();
  }
}

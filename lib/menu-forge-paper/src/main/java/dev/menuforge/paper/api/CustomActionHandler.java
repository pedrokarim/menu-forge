package dev.menuforge.paper.api;

import java.util.Map;

/**
 * Traitement d’une action {@code custom} du format, enregistré par id : c’est la
 * porte vers l’infrastructure du serveur (récompenses, requêtes, actions
 * existantes…).
 */
@FunctionalInterface
public interface CustomActionHandler {

  /**
   * Exécute l’action.
   *
   * @param context contexte du clic
   * @param args    arguments {@code args} du format (objets Java simples, non interpolés)
   */
  void handle(ActionContext context, Map<String, Object> args);
}

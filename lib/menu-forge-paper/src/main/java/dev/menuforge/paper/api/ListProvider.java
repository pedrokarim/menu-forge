package dev.menuforge.paper.api;

import java.util.List;

/**
 * Source de données nommée des slots {@code list}. Appelée à chaque
 * construction du menu (ouverture, changement d’état, changement de page) :
 * elle renvoie <b>toutes</b> les entrées, la lib se charge de la pagination.
 */
@FunctionalInterface
public interface ListProvider {

  /** Entrées de la liste pour ce joueur et cet état de menu. */
  List<ListEntry> entries(ListRequest request);
}

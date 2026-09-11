package dev.menuforge.paper.api;

import dev.menuforge.model.MenuDefinition;
import dev.menuforge.pack.GeneratedPack;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;

/**
 * API publique de MenuForge, publiée dans le {@code ServicesManager} de Bukkit.
 *
 * <pre>{@code
 * MenuForgeApi api = MenuForgeApi.get();
 * api.registerListProvider("badges", request -> ...);
 * api.registerCustomAction("monserveur:reward", (context, args) -> ...);
 * api.open(player, "badges");
 * }</pre>
 *
 * <p>Toutes les méthodes s’appellent depuis le thread principal du serveur.
 */
public interface MenuForgeApi {

  /**
   * L’instance publiée par le plugin MenuForge.
   *
   * @throws IllegalStateException si MenuForge n’est pas chargé
   */
  static MenuForgeApi get() {
    final MenuForgeApi api = Bukkit.getServicesManager().load(MenuForgeApi.class);
    if (api == null) {
      throw new IllegalStateException("MenuForge n’est pas chargé");
    }
    return api;
  }

  // --- Ouverture -------------------------------------------------------------

  /**
   * Ouvre un menu (empilé si le joueur en a déjà un ouvert : {@code back} y revient).
   *
   * @throws IllegalArgumentException si le menu est inconnu
   */
  void open(Player player, String menuId);

  /**
   * Ouvre un menu avec des valeurs d’état imposées.
   *
   * @throws IllegalArgumentException si le menu est inconnu ou une valeur invalide
   */
  void open(Player player, String menuId, Map<String, Object> initialState);

  /** Session du joueur, s’il a un menu MenuForge ouvert. */
  Optional<MenuSession> session(Player player);

  /** Reconstruit le menu ouvert du joueur (après un changement de données). Sans effet sinon. */
  void refresh(Player player);

  // --- SPI -----------------------------------------------------------------

  /** Enregistre (ou remplace) la source de données des slots {@code list} nommés {@code list}. */
  void registerListProvider(String list, ListProvider provider);

  /** Retire une source de données. */
  void unregisterListProvider(String list);

  /** Ajoute un fournisseur de drapeaux ({@code viewer.*}, drapeaux custom). */
  void registerFlagProvider(FlagProvider provider);

  /** Ajoute une source de variables pour les noms que la lib ne connaît pas. */
  void registerPlaceholderResolver(PlaceholderResolver resolver);

  /** Remplace la fabrique d’items ({@code ref} et item invisible). {@code null} = fabrique par défaut. */
  void setItemFactory(ItemFactory factory);

  /** Fabrique d’items par défaut (utile pour déléguer depuis une fabrique custom). */
  ItemFactory defaultItemFactory();

  /** Enregistre (ou remplace) le traitement des actions {@code custom} d’id {@code id}. */
  void registerCustomAction(String id, CustomActionHandler handler);

  /** Retire un traitement d’action {@code custom}. */
  void unregisterCustomAction(String id);

  // --- Contenu et pack -----------------------------------------------------

  /** Ids des menus chargés (gabarits exclus). */
  Set<String> menuIds();

  /** Définition résolue d’un menu chargé. */
  Optional<MenuDefinition> menu(String menuId);

  /** Fichiers du dernier pack généré (chemins relatifs à la racine du pack). */
  GeneratedPack generatedPack();

  /** Dossier où le pack est écrit ({@code plugins/MenuForge/pack}). */
  Path packDirectory();

  /** Espace de noms des polices et textures générées. */
  String namespace();

  /** Recharge la configuration, les menus et les textures, et régénère le pack. Ferme les menus ouverts. */
  void reload();

  // --- Espaces de travail supplémentaires ----------------------------------

  /**
   * Ajoute un espace de travail lu à chaque rechargement, après celui de
   * MenuForge ({@code plugins/MenuForge/workspace}) : ses menus
   * ({@code root/menus/**}) et ses textures ({@code root/textures/**}).
   * C’est ainsi qu’un plugin embarque ses propres menus. Ne recharge pas :
   * appeler {@link #reload()} ensuite.
   *
   * <p>Un id de menu déjà fourni par un espace précédent est refusé (erreur de
   * rechargement) ; une texture est prise dans le premier espace qui la possède.
   */
  void addWorkspace(Path root);

  /** Retire un espace ajouté par {@link #addWorkspace(Path)}. Ne recharge pas. */
  void removeWorkspace(Path root);

  /** Espaces lus au rechargement, dans l’ordre (celui de MenuForge en premier). */
  List<Path> workspaces();

  /**
   * Appelé après chaque rechargement réussi ou non (démarrage compris), avec
   * le pack régénéré : permet à un serveur de reconstruire son propre
   * resource pack. Appelé sur le thread principal.
   */
  void registerReloadListener(Consumer<GeneratedPack> listener);

  /** Retire un écouteur de rechargement. */
  void unregisterReloadListener(Consumer<GeneratedPack> listener);
}

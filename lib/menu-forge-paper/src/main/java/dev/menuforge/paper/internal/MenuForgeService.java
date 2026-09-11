package dev.menuforge.paper.internal;

import dev.menuforge.MenuForgeException;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.pack.GeneratedPack;
import dev.menuforge.pack.PackGenerator;
import dev.menuforge.pack.PackWriter;
import dev.menuforge.paper.MenuForgePlugin;
import dev.menuforge.paper.api.CustomActionHandler;
import dev.menuforge.paper.api.FlagProvider;
import dev.menuforge.paper.api.ItemFactory;
import dev.menuforge.paper.api.ListProvider;
import dev.menuforge.paper.api.MenuForgeApi;
import dev.menuforge.paper.api.MenuSession;
import dev.menuforge.paper.api.PlaceholderResolver;
import dev.menuforge.render.CompiledMenu;
import dev.menuforge.render.TitleRenderer;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** Implémentation de {@link MenuForgeApi} : registres des SPI, menus chargés, pack. */
public final class MenuForgeService implements MenuForgeApi {

  private final MenuForgePlugin plugin;
  private final Map<String, ListProvider> listProviders = new ConcurrentHashMap<>();
  private final List<FlagProvider> flagProviders = new CopyOnWriteArrayList<>();
  private final List<PlaceholderResolver> placeholderResolvers = new CopyOnWriteArrayList<>();
  private final Map<String, CustomActionHandler> customActions = new ConcurrentHashMap<>();
  private final List<Path> extraWorkspaces = new CopyOnWriteArrayList<>();
  private final List<Consumer<GeneratedPack>> reloadListeners = new CopyOnWriteArrayList<>();
  private final SessionManager sessions = new SessionManager();
  private final ItemRenderer itemRenderer = new ItemRenderer(this);
  private final ActionExecutor actionExecutor = new ActionExecutor(this);

  private InventoryFactory inventoryFactory = org.bukkit.Bukkit::createInventory;
  private ItemFactory customItemFactory;
  private DefaultItemFactory defaultItemFactory = new DefaultItemFactory(Material.PAPER, null, 0);
  private Map<String, CompiledMenu> menus = Map.of();
  private GeneratedPack pack = GeneratedPack.empty();
  private String namespace = PackGenerator.DEFAULT_NAMESPACE;
  private TitleRenderer titleRenderer = new TitleRenderer();

  public MenuForgeService(final MenuForgePlugin plugin) {
    this.plugin = plugin;
  }

  // --- Chargement ------------------------------------------------------------

  /** Bilan d’un rechargement. */
  public record ReloadReport(int menus, int files, List<String> errors) {
  }

  /**
   * Relit la configuration et l’espace de travail, régénère et écrit le pack.
   * Ferme d’abord les menus ouverts (leurs définitions vont changer).
   */
  public ReloadReport reloadWorkspace() {
    sessions.closeAll();
    plugin.reloadConfig();
    final FileConfiguration config = plugin.getConfig();

    String configuredNamespace = config.getString("namespace", PackGenerator.DEFAULT_NAMESPACE);
    try {
      PackGenerator.checkNamespace(configuredNamespace);
    } catch (final IllegalArgumentException exception) {
      logger().warning("namespace invalide dans config.yml (« " + configuredNamespace + " »), « "
        + PackGenerator.DEFAULT_NAMESPACE + " » utilisé à la place");
      configuredNamespace = PackGenerator.DEFAULT_NAMESPACE;
    }
    namespace = configuredNamespace;
    titleRenderer = new TitleRenderer(namespace);
    defaultItemFactory = DefaultItemFactory.fromConfig(config, logger());

    final Path workspace = plugin.getDataFolder().toPath().resolve("workspace");
    final Path menusDirectory = workspace.resolve("menus");
    final Path texturesDirectory = workspace.resolve("textures");
    try {
      Files.createDirectories(menusDirectory);
      Files.createDirectories(texturesDirectory);
    } catch (final IOException exception) {
      logger().log(Level.SEVERE, "impossible de créer l’espace de travail " + workspace, exception);
    }

    final List<WorkspaceLoader.Root> roots = new java.util.ArrayList<>();
    roots.add(new WorkspaceLoader.Root(menusDirectory, texturesDirectory, ""));
    for (final Path extra : extraWorkspaces) {
      roots.add(WorkspaceLoader.Root.of(extra, extra.getFileName() + ":"));
    }
    final WorkspaceLoader.Result loaded = WorkspaceLoader.load(roots, logger());
    menus = Collections.unmodifiableMap(loaded.menus());

    GeneratedPack generated = GeneratedPack.empty();
    final List<String> errors = new java.util.ArrayList<>(loaded.errors());
    try {
      final List<MenuDefinition> definitions = menus.values().stream().map(CompiledMenu::menu).collect(Collectors.toList());
      generated = new PackGenerator(namespace).generate(definitions, loaded.textures())
        .merge(PackGenerator.packMeta(config.getInt("pack.format", 46), "Polices générées par menu-forge"));
      writePack(generated, config.getBoolean("pack.zip", true));
    } catch (final MenuForgeException | IOException exception) {
      final String message = "échec de la génération du pack : " + exception.getMessage();
      errors.add(message);
      logger().log(Level.SEVERE, message, exception);
    }
    pack = generated;
    for (final Consumer<GeneratedPack> listener : reloadListeners) {
      try {
        listener.accept(generated);
      } catch (final RuntimeException exception) {
        logger().log(Level.WARNING, "écouteur de rechargement en erreur", exception);
      }
    }

    final int userMenus = (int) menus.keySet().stream().filter(id -> !WorkspaceLoader.isBuiltIn(id)).count();
    logger().info(userMenus + " menu(s) chargé(s), " + pack.size() + " fichier(s) de pack écrits dans " + packDirectory()
      + (errors.isEmpty() ? "" : " (" + errors.size() + " erreur(s))"));
    return new ReloadReport(userMenus, pack.size(), List.copyOf(errors));
  }

  private void writePack(final GeneratedPack generated, final boolean zip) throws IOException {
    final Path directory = packDirectory();
    // Seuls les dossiers générés par menu-forge sont vidés.
    deleteRecursively(directory.resolve("assets").resolve(namespace).resolve("font").resolve("menus"));
    deleteRecursively(directory.resolve("assets").resolve(namespace).resolve("textures").resolve("menus"));
    PackWriter.writeDirectory(generated, directory);
    if (zip) {
      PackWriter.writeZip(generated, plugin.getDataFolder().toPath().resolve("pack.zip"));
    }
  }

  private static void deleteRecursively(final Path directory) throws IOException {
    if (!Files.exists(directory)) {
      return;
    }
    try (Stream<Path> paths = Files.walk(directory)) {
      for (final Path path : paths.sorted(Comparator.reverseOrder()).collect(Collectors.toList())) {
        Files.delete(path);
      }
    }
  }

  /** Ferme les menus ouverts (arrêt du plugin). */
  public void shutdown() {
    sessions.closeAll();
  }

  // --- Accès internes --------------------------------------------------------

  MenuForgePlugin plugin() {
    return plugin;
  }

  Logger logger() {
    return plugin.getLogger();
  }

  SessionManager sessions() {
    return sessions;
  }

  ItemRenderer itemRenderer() {
    return itemRenderer;
  }

  ActionExecutor actionExecutor() {
    return actionExecutor;
  }

  TitleRenderer titleRenderer() {
    return titleRenderer;
  }

  InventoryFactory inventoryFactory() {
    return inventoryFactory;
  }

  /** Remplace la création des coffres (tests uniquement). */
  void setInventoryFactory(final InventoryFactory factory) {
    inventoryFactory = Objects.requireNonNull(factory, "factory");
  }

  Optional<CompiledMenu> compiled(final String menuId) {
    return Optional.ofNullable(menus.get(menuId));
  }

  ListProvider listProvider(final String list) {
    return listProviders.get(list);
  }

  CustomActionHandler customAction(final String id) {
    return customActions.get(id);
  }

  ItemFactory itemFactory() {
    return customItemFactory != null ? customItemFactory : defaultItemFactory;
  }

  /** Valeur d’un drapeau fourni par le serveur ({@code false} si personne ne le connaît). */
  boolean flag(final Player viewer, final String name) {
    for (final FlagProvider provider : flagProviders) {
      try {
        final Boolean value = provider.flag(viewer, name);
        if (value != null) {
          return value;
        }
      } catch (final RuntimeException exception) {
        logger().log(Level.WARNING, "fournisseur de drapeaux en erreur pour « " + name + " »", exception);
      }
    }
    return false;
  }

  /** Valeur d’une variable fournie par le serveur, ou {@code null}. */
  String placeholder(final Player viewer, final String name) {
    for (final PlaceholderResolver resolver : placeholderResolvers) {
      try {
        final String value = resolver.resolve(viewer, name);
        if (value != null) {
          return value;
        }
      } catch (final RuntimeException exception) {
        logger().log(Level.WARNING, "résolution de variable en erreur pour « " + name + " »", exception);
      }
    }
    return null;
  }

  // --- API ---------------------------------------------------------------------

  @Override
  public void open(final Player player, final String menuId) {
    open(player, menuId, Map.of());
  }

  @Override
  public void open(final Player player, final String menuId, final Map<String, Object> initialState) {
    Objects.requireNonNull(player, "player");
    if (!menus.containsKey(menuId)) {
      throw new IllegalArgumentException("menu inconnu : « " + menuId + " »");
    }
    sessions.getOrCreate(this, player).open(menuId, initialState == null ? Map.of() : initialState);
  }

  @Override
  public Optional<MenuSession> session(final Player player) {
    return sessions.get(player.getUniqueId()).map(session -> session);
  }

  @Override
  public void refresh(final Player player) {
    sessions.get(player.getUniqueId()).ifPresent(MenuSessionImpl::refresh);
  }

  @Override
  public void registerListProvider(final String list, final ListProvider provider) {
    listProviders.put(Objects.requireNonNull(list, "list"), Objects.requireNonNull(provider, "provider"));
  }

  @Override
  public void unregisterListProvider(final String list) {
    listProviders.remove(list);
  }

  @Override
  public void registerFlagProvider(final FlagProvider provider) {
    flagProviders.add(Objects.requireNonNull(provider, "provider"));
  }

  @Override
  public void unregisterFlagProvider(final FlagProvider provider) {
    flagProviders.remove(provider);
  }

  @Override
  public void registerPlaceholderResolver(final PlaceholderResolver resolver) {
    placeholderResolvers.add(Objects.requireNonNull(resolver, "resolver"));
  }

  @Override
  public void unregisterPlaceholderResolver(final PlaceholderResolver resolver) {
    placeholderResolvers.remove(resolver);
  }

  @Override
  public void setItemFactory(final ItemFactory factory) {
    customItemFactory = factory;
  }

  @Override
  public ItemFactory defaultItemFactory() {
    return defaultItemFactory;
  }

  @Override
  public void registerCustomAction(final String id, final CustomActionHandler handler) {
    customActions.put(Objects.requireNonNull(id, "id"), Objects.requireNonNull(handler, "handler"));
  }

  @Override
  public void unregisterCustomAction(final String id) {
    customActions.remove(id);
  }

  @Override
  public Set<String> menuIds() {
    return menus.keySet();
  }

  @Override
  public Optional<MenuDefinition> menu(final String menuId) {
    return compiled(menuId).map(CompiledMenu::menu);
  }

  @Override
  public GeneratedPack generatedPack() {
    return pack;
  }

  @Override
  public Path packDirectory() {
    return plugin.getDataFolder().toPath().resolve("pack");
  }

  @Override
  public String namespace() {
    return namespace;
  }

  @Override
  public void reload() {
    reloadWorkspace();
  }

  @Override
  public void addWorkspace(final Path root) {
    final Path normalized = Objects.requireNonNull(root, "root").toAbsolutePath().normalize();
    if (!extraWorkspaces.contains(normalized)) {
      extraWorkspaces.add(normalized);
    }
  }

  @Override
  public void removeWorkspace(final Path root) {
    extraWorkspaces.remove(Objects.requireNonNull(root, "root").toAbsolutePath().normalize());
  }

  @Override
  public List<Path> workspaces() {
    final List<Path> all = new java.util.ArrayList<>();
    all.add(plugin.getDataFolder().toPath().resolve("workspace").toAbsolutePath().normalize());
    all.addAll(extraWorkspaces);
    return List.copyOf(all);
  }

  @Override
  public void registerReloadListener(final Consumer<GeneratedPack> listener) {
    reloadListeners.add(Objects.requireNonNull(listener, "listener"));
  }

  @Override
  public void unregisterReloadListener(final Consumer<GeneratedPack> listener) {
    reloadListeners.remove(listener);
  }

  /** Clé d’espace de noms utilitaire (utilisée par la fabrique par défaut). */
  static NamespacedKey parseKey(final String value) {
    return value == null || value.isBlank() ? null : NamespacedKey.fromString(value);
  }
}

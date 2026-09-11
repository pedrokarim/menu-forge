package dev.menuforge.paper.internal;

import dev.menuforge.MenuForgeException;
import dev.menuforge.calibration.CalibrationMenu;
import dev.menuforge.image.CompositeTextureSource;
import dev.menuforge.image.DirectoryTextureSource;
import dev.menuforge.image.TextureLibrary;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.parse.MenuParser;
import dev.menuforge.parse.MenuValidator;
import dev.menuforge.render.CompiledMenu;
import dev.menuforge.template.TemplateResolver;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.logging.Logger;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Charge un ou plusieurs espaces de travail : tous les {@code *.menu.json}
 * (sous-dossiers compris) de chaque {@code <racine>/menus/}, et les textures
 * de chaque {@code <racine>/textures/}. Un fichier invalide est signalé et
 * ignoré, sans empêcher le chargement des autres.
 *
 * <p>Les espaces sont lus dans l’ordre : un id de menu déjà vu est refusé, et
 * une texture est prise dans le premier espace qui la possède.
 */
final class WorkspaceLoader {

  /** Suffixe des fichiers de menu. */
  static final String SUFFIX = ".menu.json";

  private WorkspaceLoader() {
  }

  /**
   * @param menus    menus résolus, validés et mesurés, par id (calibration comprise)
   * @param textures bibliothèque de textures utilisée
   * @param errors   erreurs rencontrées, une par ligne
   */
  record Result(Map<String, CompiledMenu> menus, TextureLibrary textures, List<String> errors) {
  }

  /** Menus fournis par la lib elle-même. */
  static boolean isBuiltIn(final String menuId) {
    return CalibrationMenu.MENU_ID.equals(menuId);
  }

  /** Charge un seul espace de travail (dossiers des menus et des textures donnés). */
  static Result load(final Path menusDirectory, final Path texturesDirectory, final Logger logger) {
    return load(List.of(new Root(menusDirectory, texturesDirectory, "")), logger);
  }

  /**
   * Un espace de travail.
   *
   * @param menus    dossier des menus
   * @param textures dossier des textures
   * @param label    préfixe des messages d’erreur (vide pour l’espace du plugin)
   */
  record Root(Path menus, Path textures, String label) {

    /** Espace de racine {@code root} ({@code root/menus}, {@code root/textures}). */
    static Root of(final Path root, final String label) {
      return new Root(root.resolve("menus"), root.resolve("textures"), label);
    }
  }

  static Result load(final List<Root> roots, final Logger logger) {
    final List<String> errors = new ArrayList<>();
    final Map<String, MenuDefinition> definitions = new LinkedHashMap<>();
    final Map<String, String> sources = new LinkedHashMap<>();
    final MenuParser parser = new MenuParser();

    for (final Root root : roots) {
      for (final Path file : menuFiles(root.menus(), errors)) {
        final String source = root.label() + root.menus().relativize(file).toString().replace('\\', '/');
        try {
          final MenuDefinition definition = parser.parse(file);
          if (isBuiltIn(definition.id())) {
            errors.add(source + " : l’id « " + definition.id() + " » est réservé");
          } else if (definitions.containsKey(definition.id())) {
            errors.add(source + " : id « " + definition.id() + " » déjà utilisé par " + sources.get(definition.id()));
          } else {
            definitions.put(definition.id(), definition);
            sources.put(definition.id(), source);
          }
        } catch (final MenuForgeException exception) {
          errors.add(root.label() + exception.getMessage());
        } catch (final IOException exception) {
          errors.add(source + " : lecture impossible : " + exception.getMessage());
        }
      }
    }

    final TextureLibrary textures = new TextureLibrary(new CompositeTextureSource(
      roots.stream().map(root -> new DirectoryTextureSource(root.textures())).collect(Collectors.toList())));
    final TemplateResolver resolver = new TemplateResolver(definitions::get);
    final Map<String, CompiledMenu> menus = new TreeMap<>();
    int bedrockForms = 0;
    for (final MenuDefinition definition : definitions.values()) {
      // Gabarits et composants : des pièces assemblées dans les menus, jamais ouvertes seules.
      if (definition.partial()) {
        continue;
      }
      // Formulaires Bedrock : pas de rendu Java, ignorés sans erreur.
      if (definition.bedrockForm()) {
        bedrockForms++;
        continue;
      }
      try {
        final MenuDefinition resolved = resolver.resolve(definition);
        MenuValidator.validate(resolved);
        menus.put(resolved.id(), CompiledMenu.compile(resolved, textures));
      } catch (final MenuForgeException exception) {
        errors.add(sources.get(definition.id()) + " : " + exception.getMessage());
      }
    }

    if (bedrockForms > 0) {
      logger.info(bedrockForms + " formulaire(s) Bedrock ignoré(s) : pas de rendu Java");
    }

    final MenuDefinition calibration = CalibrationMenu.register(textures, 6);
    menus.put(calibration.id(), CompiledMenu.compile(calibration, textures));

    errors.forEach(logger::warning);
    return new Result(menus, textures, errors);
  }

  private static List<Path> menuFiles(final Path directory, final List<String> errors) {
    if (!Files.isDirectory(directory)) {
      return List.of();
    }
    try (Stream<Path> paths = Files.walk(directory)) {
      return paths
        .filter(Files::isRegularFile)
        .filter(path -> path.getFileName().toString().endsWith(SUFFIX))
        .sorted()
        .collect(Collectors.toList());
    } catch (final IOException exception) {
      errors.add("lecture du dossier des menus impossible : " + exception.getMessage());
      return List.of();
    }
  }
}

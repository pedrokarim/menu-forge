package dev.menuforge.paper.internal;

import dev.menuforge.MenuForgeException;
import dev.menuforge.calibration.CalibrationMenu;
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
 * Charge l’espace de travail : tous les {@code *.menu.json} (sous-dossiers
 * compris) et leurs textures. Un fichier invalide est signalé et ignoré, sans
 * empêcher le chargement des autres.
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

  static Result load(final Path menusDirectory, final Path texturesDirectory, final Logger logger) {
    final List<String> errors = new ArrayList<>();
    final Map<String, MenuDefinition> definitions = new LinkedHashMap<>();
    final Map<String, String> sources = new LinkedHashMap<>();
    final MenuParser parser = new MenuParser();

    for (final Path file : menuFiles(menusDirectory, errors)) {
      final String source = menusDirectory.relativize(file).toString().replace('\\', '/');
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
        errors.add(exception.getMessage());
      } catch (final IOException exception) {
        errors.add(source + " : lecture impossible : " + exception.getMessage());
      }
    }

    final TextureLibrary textures = new TextureLibrary(new DirectoryTextureSource(texturesDirectory));
    final TemplateResolver resolver = new TemplateResolver(definitions::get);
    final Map<String, CompiledMenu> menus = new TreeMap<>();
    for (final MenuDefinition definition : definitions.values()) {
      // Gabarits et composants : des pièces assemblées dans les menus, jamais ouvertes seules.
      if (definition.partial()) {
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

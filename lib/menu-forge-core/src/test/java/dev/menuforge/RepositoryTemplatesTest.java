package dev.menuforge;

import dev.menuforge.model.MenuDefinition;
import dev.menuforge.parse.MenuParser;
import dev.menuforge.parse.MenuValidator;
import dev.menuforge.template.TemplateResolver;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Les gabarits fournis par le dépôt ({@code templates/}) se lisent, se résolvent
 * et, pour ceux qui s’ouvrent seuls, passent la validation. Le studio les
 * valide aussi contre {@code docs/menu.schema.json} ({@code studio/tests}).
 */
class RepositoryTemplatesTest {

  @Test
  void providedTemplatesParseResolveAndValidate() throws IOException {
    final List<Path> files;
    try (Stream<Path> paths = Files.list(Path.of("../../templates"))) {
      files = paths.filter(path -> path.toString().endsWith(".menu.json")).sorted().collect(Collectors.toList());
    }
    assertFalse(files.isEmpty(), "aucun gabarit trouvé dans templates/");
    final MenuParser parser = new MenuParser();
    final Map<String, MenuDefinition> byId = new LinkedHashMap<>();
    for (final Path file : files) {
      final MenuDefinition definition = parser.parse(file);
      byId.put(definition.id(), definition);
    }
    final TemplateResolver resolver = new TemplateResolver(byId::get);
    for (final MenuDefinition definition : byId.values()) {
      final MenuDefinition resolved = resolver.resolve(definition);
      if (!definition.partial()) {
        MenuValidator.validate(resolved);
      }
    }
  }
}

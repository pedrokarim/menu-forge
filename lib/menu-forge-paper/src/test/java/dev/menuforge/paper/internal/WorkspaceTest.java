package dev.menuforge.paper.internal;

import dev.menuforge.pack.GeneratedPack;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Espaces de travail supplémentaires (menus embarqués par un plugin) et écouteurs de rechargement. */
class WorkspaceTest extends MockServerTest {

  private static final String EXTRA = """
    { "id": "extra", "container": { "type": "chest", "rows": 1 },
      "layers": [{ "id": "panel", "texture": "extra/panel.png", "x": 0, "y": 0 }] }
    """;

  @Test
  void extraWorkspaceMenusAreLoadedAndGenerated(@TempDir final Path extra) {
    writeMenu(extra, "extra", EXTRA);
    writeTexture(extra, "extra/panel.png", 20, 10);
    final List<GeneratedPack> packs = new ArrayList<>();
    final Consumer<GeneratedPack> listener = packs::add;
    service.registerReloadListener(listener);

    service.addWorkspace(extra);
    service.addWorkspace(extra); // ajouté une seule fois
    assertEquals(2, service.workspaces().size());
    final MenuForgeService.ReloadReport report = service.reloadWorkspace();

    assertEquals(List.of(), report.errors());
    assertTrue(service.menuIds().contains("extra"));
    assertEquals(1, packs.size());
    assertNotNull(packs.get(0).file("assets/menuforge/font/menus/extra.json"));
    assertNotNull(packs.get(0).file("assets/menuforge/textures/menus/extra/panel.png"));
    assertTrue(Files.exists(service.packDirectory().resolve("assets/menuforge/font/menus/extra.json")));

    service.removeWorkspace(extra);
    service.unregisterReloadListener(listener);
    service.reloadWorkspace();
    assertFalse(service.menuIds().contains("extra"));
    assertEquals(1, packs.size());
  }

  @Test
  void duplicateIdsAcrossWorkspacesAreReported(@TempDir final Path extra) {
    loadTestMenus();
    writeMenu(extra, "shop_copy", SHOP);
    writeTexture(extra, "shop/bg.png", 10, 10);
    service.addWorkspace(extra);

    final MenuForgeService.ReloadReport report = service.reloadWorkspace();
    assertEquals(1, report.errors().size());
    assertTrue(report.errors().get(0).contains("déjà utilisé"), report.errors().get(0));
    // La texture de même chemin vient du premier espace (celui de MenuForge, 176 px de large).
    assertEquals(176, service.compiled("shop").orElseThrow().bounds("shop/bg.png").orElseThrow().width());
  }

  @Test
  void bedrockFormsAreIgnoredWithoutError() {
    writeMenu(workspace, "form_hub", """
      { "id": "form_hub", "form": { "layout": "grid", "title": "Hub",
        "buttons": [{ "id": "a", "text": "A", "onClick": [{ "type": "open", "menu": "detail" }] }] } }
      """);
    writeMenu(workspace, "detail", DETAIL);

    final MenuForgeService.ReloadReport report = service.reloadWorkspace();
    assertEquals(List.of(), report.errors());
    assertTrue(service.menuIds().contains("detail"));
    assertFalse(service.menuIds().contains("form_hub"));
  }

  @Test
  void invalidMenusAreReportedWithoutBlockingTheOthers() {
    writeMenu(workspace, "broken", "{ \"id\": \"broken\", \"layers\": [{ \"id\": \"x\" }] }");
    writeMenu(workspace, "missing_texture", """
      { "id": "missing_texture", "layers": [{ "id": "x", "texture": "nowhere.png", "x": 0, "y": 0 }] }
      """);
    writeMenu(workspace, "detail", DETAIL);

    final MenuForgeService.ReloadReport report = service.reloadWorkspace();
    assertEquals(2, report.errors().size(), String.join("\n", report.errors()));
    assertTrue(service.menuIds().contains("detail"));
    assertFalse(service.menuIds().contains("broken"));
  }
}

package dev.menuforge.state;

import dev.menuforge.model.Condition;
import dev.menuforge.model.StateDefinition;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConditionTest {

  private final ConditionContext context = new ConditionContext(
    Map.of("tab", "progress", "count", 3, "enabled", true),
    Set.of("viewer.isStaff")
  );

  @Test
  void evaluatesSimpleConditions() {
    assertTrue(new Condition.Is("tab", "progress").test(context));
    assertFalse(new Condition.Is("tab", "discovery").test(context));
    assertTrue(new Condition.Is("count", 3L).test(context), "3 (long) == 3 (int)");
    assertTrue(new Condition.Is("count", "3").test(context), "comparaison normalisée");
    assertTrue(new Condition.Is("enabled", true).test(context));
    assertFalse(new Condition.Is("missing", "x").test(context));
    assertTrue(new Condition.In("tab", List.of("discovery", "progress")).test(context));
    assertFalse(new Condition.In("tab", List.of()).test(context));
    assertTrue(new Condition.Flag("viewer.isStaff").test(context));
    assertFalse(new Condition.Flag("page.hasNext").test(context));
  }

  @Test
  void evaluatesCompositeConditions() {
    final Condition yes = new Condition.Flag("viewer.isStaff");
    final Condition no = new Condition.Flag("nope");
    assertTrue(new Condition.All(List.of(yes, new Condition.Not(no))).test(context));
    assertFalse(new Condition.All(List.of(yes, no)).test(context));
    assertTrue(new Condition.All(List.of()).test(context));
    assertTrue(new Condition.Any(List.of(no, yes)).test(context));
    assertFalse(new Condition.Any(List.of()).test(context));
    assertFalse(new Condition.Not(yes).test(context));
    assertEquals(Set.of("viewer.isStaff", "nope"),
      new Condition.Any(List.of(yes, new Condition.Not(no))).referencedFlags());
  }

  @Test
  void derivesPageFlagsAndVariables() {
    final Map<String, StateDefinition> definitions = new LinkedHashMap<>();
    definitions.put("tab", new StateDefinition.EnumState(List.of("a", "b"), "a"));
    definitions.put("page", new StateDefinition.PageState("badges"));

    final StateSnapshot first = StateSnapshot.of(definitions, Map.of(), Map.of("page", 3));
    assertEquals(1, first.values().get("page"));
    assertEquals(Set.of("page.hasNext"), first.flags());
    assertEquals("1", first.variable("page.number"));
    assertEquals("3", first.variable("page.count"));
    assertEquals("a", first.variable("state.tab"));
    assertNull(first.variable("viewer.name"));

    final StateSnapshot middle = StateSnapshot.of(definitions, Map.of("page", 2), Map.of("page", 3));
    assertEquals(Set.of("page.hasPrev", "page.hasNext"), middle.flags());
    assertTrue(new Condition.Is("page", 2).test(middle.context(Set.of())));

    final StateSnapshot beyond = StateSnapshot.of(definitions, Map.of("page", 9), Map.of("page", 3));
    assertEquals(3, beyond.values().get("page"), "page ramenée au nombre de pages");
    assertEquals(Set.of("page.hasPrev"), beyond.flags());

    final StateSnapshot empty = StateSnapshot.of(definitions, Map.of(), Map.of());
    assertEquals(Set.of(), empty.flags());
    assertEquals("1", empty.variable("page.count"));

    final ConditionContext withViewer = middle.context(Set.of("viewer.isStaff"));
    assertTrue(withViewer.hasFlag("page.hasPrev"));
    assertTrue(withViewer.hasFlag("viewer.isStaff"));
  }

  @Test
  void validatesStateValues() {
    final Map<String, StateDefinition> definitions = new LinkedHashMap<>();
    definitions.put("tab", new StateDefinition.EnumState(List.of("a", "b"), "a"));
    definitions.put("level", new StateDefinition.IntState(null, 1, 5));
    definitions.put("on", new StateDefinition.BoolState(false));

    final Map<String, Object> values = StateSnapshot.initialValues(definitions, Map.of("tab", "b", "level", 99L));
    assertEquals("b", values.get("tab"));
    assertEquals(5, values.get("level"), "ramené au max");
    assertEquals(false, values.get("on"));
    assertEquals(true, definitions.get("on").coerce("true"));
    assertThrows(IllegalArgumentException.class, () -> definitions.get("tab").coerce("c"));
    assertThrows(IllegalArgumentException.class, () -> StateSnapshot.initialValues(definitions, Map.of("ghost", 1)));
    assertEquals(1, definitions.get("level").initialValue(), "défaut absent : min");
  }

  @Test
  void computesPagination() {
    assertEquals(1, Pagination.pageCount(0, 18));
    assertEquals(1, Pagination.pageCount(18, 18));
    assertEquals(2, Pagination.pageCount(19, 18));
    assertEquals(18, Pagination.firstIndex(2, 18));
  }
}

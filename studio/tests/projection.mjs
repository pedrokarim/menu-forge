/**
 * Projection d’un menu résolu comparée par les tests de parité : ce qui doit
 * être identique entre le studio (`src/model/resolve.ts`) et la lib
 * (`TemplateResolver`, test `ParityFixturesTest`). Même forme des deux côtés.
 */
export function projectMenu(menu) {
  const withCondition = (target, key, condition) => {
    if (condition) target[key] = condition;
    return target;
  };
  return {
    state: Object.entries(menu.state ?? {}).map(([name, definition]) => [name, definition.type]),
    layers: menu.layers.map((layer) =>
      withCondition({ id: layer.id, texture: layer.texture, x: layer.x, y: layer.y }, 'visibleWhen', layer.visibleWhen),
    ),
    texts: (menu.texts ?? []).map((text) =>
      withCondition({ id: text.id, x: text.x, y: text.y, value: text.value }, 'visibleWhen', text.visibleWhen),
    ),
    slots: (menu.slots ?? []).map((slot) => {
      const projected = {
        id: slot.id,
        kind: slot.kind,
        col: slot.area.col,
        row: slot.area.row,
        width: slot.area.width ?? 1,
        height: slot.area.height ?? 1,
        actions: (slot.onClick ?? []).map((action) => action.type),
      };
      withCondition(projected, 'visibleWhen', slot.visibleWhen);
      return withCondition(projected, 'enabledWhen', slot.enabledWhen);
    }),
  };
}

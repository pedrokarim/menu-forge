package dev.menuforge.model;

import dev.menuforge.state.ConditionContext;

import java.util.List;
import java.util.Objects;

/**
 * Une zone de slots et son comportement.
 *
 * @param id          identifiant
 * @param kind        type de slot
 * @param area        zone couverte
 * @param item        item affiché, ou {@code null} (pour {@code list}, fourni par la source)
 * @param list        nom de la source de données (slots {@code list} uniquement)
 * @param onClick     actions exécutées au clic
 * @param visibleWhen le slot est vide si la condition est fausse ({@code null} = toujours)
 * @param enabledWhen le slot ne réagit pas si la condition est fausse ({@code null} = toujours)
 */
public record Slot(
  String id,
  SlotKind kind,
  SlotArea area,
  ItemSpec item,
  String list,
  List<Action> onClick,
  Condition visibleWhen,
  Condition enabledWhen
) implements Identified {

  public Slot {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(kind, "kind");
    Objects.requireNonNull(area, "area");
    onClick = List.copyOf(onClick == null ? List.of() : onClick);
  }

  /** Le slot est-il visible dans ce contexte ? */
  public boolean isVisible(final ConditionContext context) {
    return visibleWhen == null || visibleWhen.test(context);
  }

  /** Le slot réagit-il aux clics dans ce contexte ? */
  public boolean isEnabled(final ConditionContext context) {
    return enabledWhen == null || enabledWhen.test(context);
  }
}

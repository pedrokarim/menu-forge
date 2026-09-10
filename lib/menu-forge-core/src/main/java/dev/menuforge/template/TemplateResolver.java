package dev.menuforge.template;

import dev.menuforge.model.ContainerSpec;
import dev.menuforge.model.Identified;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.StateDefinition;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;

/**
 * Résout l’héritage {@code extends} d’un menu.
 *
 * <p>Règles (identiques côté studio) :
 * <ul>
 *   <li>les gabarits sont appliqués dans l’ordre de la liste, chacun étant
 *       lui-même résolu d’abord ; le menu passe en dernier ;</li>
 *   <li>{@code state} : fusion clé par clé, le dernier appliqué gagne ;</li>
 *   <li>{@code layers}, {@code texts}, {@code slots} : les éléments hérités
 *       d’abord, puis ceux du menu ; un {@code id} identique remplace l’élément
 *       hérité <b>à sa position</b> ;</li>
 *   <li>{@code container} : celui du menu, sinon celui du dernier gabarit qui
 *       en déclare un, sinon un coffre de 6 lignes.</li>
 * </ul>
 * Un cycle d’héritage ou un gabarit introuvable lève une
 * {@link TemplateResolutionException}.
 */
public final class TemplateResolver {

  private final Function<String, MenuDefinition> lookup;

  /**
   * @param lookup trouve un gabarit (ou un menu) par id ; renvoie {@code null} s’il n’existe pas
   */
  public TemplateResolver(final Function<String, MenuDefinition> lookup) {
    this.lookup = Objects.requireNonNull(lookup, "lookup");
  }

  /** Menu résolu : {@code parents} vide, {@code container} renseigné. */
  public MenuDefinition resolve(final MenuDefinition menu) {
    final MenuDefinition resolved = resolve(menu, new ArrayList<>());
    return new MenuDefinition(resolved.formatVersion(), resolved.id(), resolved.name(), resolved.template(), List.of(),
      resolved.effectiveContainer(), resolved.state(), resolved.layers(), resolved.texts(), resolved.slots());
  }

  private MenuDefinition resolve(final MenuDefinition menu, final List<String> chain) {
    if (chain.contains(menu.id())) {
      final List<String> cycle = new ArrayList<>(chain.subList(chain.indexOf(menu.id()), chain.size()));
      cycle.add(menu.id());
      throw new TemplateResolutionException("cycle de gabarits : " + String.join(" → ", cycle));
    }
    final List<String> nextChain = new ArrayList<>(chain);
    nextChain.add(menu.id());

    MenuDefinition accumulated = null;
    for (final String parentId : menu.parents()) {
      final MenuDefinition parent = lookup.apply(parentId);
      if (parent == null) {
        throw new TemplateResolutionException("gabarit introuvable « " + parentId + " » (hérité par « " + menu.id() + " »)");
      }
      final MenuDefinition resolvedParent = resolve(parent, nextChain);
      accumulated = accumulated == null ? resolvedParent : merge(accumulated, resolvedParent);
    }
    final MenuDefinition merged = accumulated == null ? menu : merge(accumulated, menu);
    return new MenuDefinition(menu.formatVersion(), menu.id(), menu.name(), menu.template(), List.of(),
      merged.container(), merged.state(), merged.layers(), merged.texts(), merged.slots());
  }

  /** Applique {@code top} par-dessus {@code base} (sans toucher à l’identité). */
  static MenuDefinition merge(final MenuDefinition base, final MenuDefinition top) {
    final ContainerSpec container = top.container() != null ? top.container() : base.container();
    final Map<String, StateDefinition> state = new LinkedHashMap<>(base.state());
    state.putAll(top.state());
    return new MenuDefinition(top.formatVersion(), top.id(), top.name(), top.template(), List.of(), container, state,
      mergeById(base.layers(), top.layers()),
      mergeById(base.texts(), top.texts()),
      mergeById(base.slots(), top.slots()));
  }

  /**
   * Éléments de {@code base} puis ceux de {@code top} ; un élément de
   * {@code top} dont l’id existe déjà remplace l’existant à sa position.
   */
  public static <T extends Identified> List<T> mergeById(final List<T> base, final List<T> top) {
    final List<T> result = new ArrayList<>(base);
    for (final T element : top) {
      int index = -1;
      for (int i = 0; i < result.size(); i++) {
        if (result.get(i).id().equals(element.id())) {
          index = i;
          break;
        }
      }
      if (index >= 0) {
        result.set(index, element);
      } else {
        result.add(element);
      }
    }
    return result;
  }
}

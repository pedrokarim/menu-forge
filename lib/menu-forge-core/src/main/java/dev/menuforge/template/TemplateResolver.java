package dev.menuforge.template;

import dev.menuforge.model.Condition;
import dev.menuforge.model.ContainerSpec;
import dev.menuforge.model.Identified;
import dev.menuforge.model.Include;
import dev.menuforge.model.Layer;
import dev.menuforge.model.MenuDefinition;
import dev.menuforge.model.Slot;
import dev.menuforge.model.SlotArea;
import dev.menuforge.model.StateDefinition;
import dev.menuforge.model.TextElement;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
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
 *       en déclare un, sinon un coffre de 6 lignes ;</li>
 *   <li>{@code includes} : les éléments de chaque composant (résolu d’abord),
 *       décalés de {@code col} / {@code row} cases (18 px par case pour les
 *       couches et les textes, plus {@code x} / {@code y}), préfixés par
 *       {@code prefix} et soumis en plus à {@code visibleWhen}, forment les
 *       éléments propres du menu, avant les siens (un id repris remplace
 *       l’élément de l’instance à sa position).</li>
 * </ul>
 * Un cycle, un gabarit ou un composant introuvable, deux instances qui
 * produisent le même id ou une zone qui sort de la grille lèvent une
 * {@link TemplateResolutionException}.
 */
public final class TemplateResolver {

  /** Taille d’une case du coffre, en pixels fenêtre (voir {@code docs/rendering.md}, § 2). */
  private static final int CELL = 18;

  private final Function<String, MenuDefinition> lookup;

  /**
   * @param lookup trouve un gabarit (ou un menu) par id ; renvoie {@code null} s’il n’existe pas
   */
  public TemplateResolver(final Function<String, MenuDefinition> lookup) {
    this.lookup = Objects.requireNonNull(lookup, "lookup");
  }

  /** Menu résolu : {@code parents} et {@code includes} vides, {@code container} renseigné. */
  public MenuDefinition resolve(final MenuDefinition menu) {
    final MenuDefinition resolved = resolve(menu, new ArrayList<>());
    return new MenuDefinition(resolved.formatVersion(), resolved.id(), resolved.name(), resolved.template(), List.of(),
      resolved.effectiveContainer(), resolved.state(), resolved.layers(), resolved.texts(), resolved.slots(),
      resolved.component(), List.of());
  }

  private MenuDefinition resolve(final MenuDefinition menu, final List<String> chain) {
    if (chain.contains(menu.id())) {
      final List<String> cycle = new ArrayList<>(chain.subList(chain.indexOf(menu.id()), chain.size()));
      cycle.add(menu.id());
      throw new TemplateResolutionException("cycle de gabarits ou de composants : " + String.join(" → ", cycle));
    }
    final List<String> nextChain = new ArrayList<>(chain);
    nextChain.add(menu.id());

    MenuDefinition accumulated = null;
    for (final String parentId : menu.parents()) {
      final MenuDefinition parent = lookup.apply(parentId);
      if (parent == null) {
        throw new TemplateResolutionException("gabarit introuvable « " + parentId + " » (hérité par « " + menu.id() + " »)");
      }
      if (parent.bedrockForm()) {
        throw new TemplateResolutionException("« " + parentId + " » est un formulaire Bedrock : il ne peut pas servir de gabarit"
          + " (hérité par « " + menu.id() + " »)");
      }
      final MenuDefinition resolvedParent = resolve(parent, nextChain);
      accumulated = accumulated == null ? resolvedParent : merge(accumulated, resolvedParent);
    }
    // Éléments propres : ceux des instances de composants, puis ceux du menu (un id repris remplace l’élément de l’instance).
    final MenuDefinition own = expandIncludes(menu, nextChain);
    final MenuDefinition merged = accumulated == null ? own : merge(accumulated, own);
    return new MenuDefinition(menu.formatVersion(), menu.id(), menu.name(), menu.template(), List.of(),
      merged.container(), merged.state(), merged.layers(), merged.texts(), merged.slots(), menu.component(), List.of());
  }

  /**
   * Remplace les instances de composants ({@code includes}) par leurs éléments,
   * décalés et préfixés, placés sous ceux du menu. Chaque composant est d’abord
   * résolu (ses propres gabarits et composants compris) ; son état est fusionné
   * clé par clé, celui du menu gagne.
   */
  private MenuDefinition expandIncludes(final MenuDefinition menu, final List<String> chain) {
    if (menu.includes().isEmpty()) {
      return menu;
    }
    final List<Layer> layers = new ArrayList<>();
    final List<TextElement> texts = new ArrayList<>();
    final List<Slot> slots = new ArrayList<>();
    final Map<String, StateDefinition> state = new LinkedHashMap<>();
    final Set<String> layerIds = new HashSet<>();
    final Set<String> textIds = new HashSet<>();
    final Set<String> slotIds = new HashSet<>();
    for (final Include include : menu.includes()) {
      final MenuDefinition component = lookup.apply(include.component());
      if (component == null) {
        throw new TemplateResolutionException("composant introuvable « " + include.component() + " » (inclus par « "
          + menu.id() + " »)");
      }
      if (component.bedrockForm()) {
        throw new TemplateResolutionException("« " + include.component() + " » est un formulaire Bedrock : il ne peut pas"
          + " servir de composant (inclus par « " + menu.id() + " »)");
      }
      final MenuDefinition resolved = resolve(component, chain);
      final String prefix = include.prefix();
      final int dx = include.col() * CELL + include.x();
      final int dy = include.row() * CELL + include.y();
      for (final Layer layer : resolved.layers()) {
        final String id = unique(layerIds, "couche", prefix + layer.id(), include);
        layers.add(new Layer(id, layer.texture(), layer.x() + dx, layer.y() + dy,
          combine(include.visibleWhen(), layer.visibleWhen())));
      }
      for (final TextElement text : resolved.texts()) {
        final String id = unique(textIds, "texte", prefix + text.id(), include);
        texts.add(new TextElement(id, text.x() + dx, text.y() + dy, text.align(), text.color(), text.value(),
          combine(include.visibleWhen(), text.visibleWhen())));
      }
      for (final Slot slot : resolved.slots()) {
        final String id = prefix + slot.id();
        final int col = slot.area().col() + include.col();
        final int row = slot.area().row() + include.row();
        if (col < 0 || row < 0) {
          throw new TemplateResolutionException("composant « " + include.component() + " » : la zone « " + id
            + " » sort de la grille (colonne " + col + ", ligne " + row + ")");
        }
        unique(slotIds, "slot", id, include);
        slots.add(new Slot(id, slot.kind(), new SlotArea(col, row, slot.area().width(), slot.area().height()),
          slot.item(), slot.list(), slot.onClick(), combine(include.visibleWhen(), slot.visibleWhen()), slot.enabledWhen()));
      }
      state.putAll(resolved.state());
    }
    state.putAll(menu.state());
    return new MenuDefinition(menu.formatVersion(), menu.id(), menu.name(), menu.template(), menu.parents(),
      menu.container(), state, mergeById(layers, menu.layers()), mergeById(texts, menu.texts()),
      mergeById(slots, menu.slots()), menu.component(), List.of());
  }

  /** Refuse un identifiant déjà produit par une instance précédente (il faut un préfixe). */
  private static String unique(final Set<String> seen, final String kind, final String id, final Include include) {
    if (!seen.add(id)) {
      throw new TemplateResolutionException("identifiant en double dans les composants : " + kind + " « " + id
        + " » (instance de « " + include.component() + " » ; donne-lui un préfixe)");
    }
    return id;
  }

  /** Condition de l’instance ajoutée à celle de l’élément : les deux doivent être vraies. */
  private static Condition combine(final Condition outer, final Condition inner) {
    if (outer == null) {
      return inner;
    }
    if (inner == null) {
      return outer;
    }
    return new Condition.All(List.of(outer, inner));
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

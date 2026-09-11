package dev.menuforge.model;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Un menu (ou un gabarit) tel que décrit par un fichier {@code *.menu.json}.
 *
 * <p>Avant résolution des gabarits, {@link #parents()} liste les gabarits dont
 * le menu hérite et {@link #container()} peut être {@code null}. Après
 * résolution ({@code TemplateResolver}), {@code parents} est vide et
 * {@code container} est toujours renseigné.
 *
 * @param formatVersion version du format (toujours {@code 1})
 * @param id            identifiant unique {@code [a-z0-9_]}, sert aussi de nom de police
 * @param name          nom lisible (outil, journaux)
 * @param template      {@code true} pour un gabarit
 * @param parents       ids des gabarits hérités (clé JSON {@code extends}), dans l’ordre
 * @param container     conteneur, ou {@code null} s’il est hérité
 * @param state         variables d’état, dans l’ordre de déclaration
 * @param layers        couches du titre, de bas en haut
 * @param texts         textes dynamiques du titre
 * @param slots         zones de slots
 * @param component     {@code true} pour un composant (inclus par d’autres menus, jamais ouvert seul)
 * @param includes      instances de composants (clé JSON {@code includes}), vides après résolution
 * @param bedrockForm   {@code true} pour un formulaire Bedrock (clé JSON {@code form}) : pas de rendu Java,
 *                      la lib le lit sans erreur mais ne l’ouvre jamais (voir {@code docs/format.md})
 */
public record MenuDefinition(
  int formatVersion,
  String id,
  String name,
  boolean template,
  List<String> parents,
  ContainerSpec container,
  Map<String, StateDefinition> state,
  List<Layer> layers,
  List<TextElement> texts,
  List<Slot> slots,
  boolean component,
  List<Include> includes,
  boolean bedrockForm
) {

  /** Seule version du format prise en charge. */
  public static final int FORMAT_VERSION = 1;

  public MenuDefinition {
    Objects.requireNonNull(id, "id");
    name = name == null ? id : name;
    parents = List.copyOf(parents == null ? List.of() : parents);
    state = Collections.unmodifiableMap(new LinkedHashMap<>(state == null ? Map.of() : state));
    layers = List.copyOf(layers == null ? List.of() : layers);
    texts = List.copyOf(texts == null ? List.of() : texts);
    slots = List.copyOf(slots == null ? List.of() : slots);
    includes = List.copyOf(includes == null ? List.of() : includes);
  }

  /** Menu sans composant ni instance (forme d’avant les composants). */
  public MenuDefinition(final int formatVersion, final String id, final String name, final boolean template,
                        final List<String> parents, final ContainerSpec container, final Map<String, StateDefinition> state,
                        final List<Layer> layers, final List<TextElement> texts, final List<Slot> slots) {
    this(formatVersion, id, name, template, parents, container, state, layers, texts, slots, false, List.of(), false);
  }

  /** Menu coffre (pas un formulaire Bedrock). */
  public MenuDefinition(final int formatVersion, final String id, final String name, final boolean template,
                        final List<String> parents, final ContainerSpec container, final Map<String, StateDefinition> state,
                        final List<Layer> layers, final List<TextElement> texts, final List<Slot> slots,
                        final boolean component, final List<Include> includes) {
    this(formatVersion, id, name, template, parents, container, state, layers, texts, slots, component, includes, false);
  }

  /** Gabarit ou composant : une pièce à assembler, sans police propre et jamais ouverte seule. */
  public boolean partial() {
    return template || component;
  }

  /** Conteneur effectif : celui du menu, ou un coffre de 6 lignes par défaut. */
  public ContainerSpec effectiveContainer() {
    return container == null ? ContainerSpec.chest(6) : container;
  }

  /** Cherche une couche par id, ou {@code null}. */
  public Layer layer(final String layerId) {
    for (final Layer layer : layers) {
      if (layer.id().equals(layerId)) {
        return layer;
      }
    }
    return null;
  }

  /** Cherche un slot par id, ou {@code null}. */
  public Slot slot(final String slotId) {
    for (final Slot slot : slots) {
      if (slot.id().equals(slotId)) {
        return slot;
      }
    }
    return null;
  }
}

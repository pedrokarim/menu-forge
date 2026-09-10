package dev.menuforge.model;

/** Élément de menu portant un identifiant (couche, texte, slot). */
public interface Identified {

  /** Identifiant, unique parmi les éléments du même type d’un menu. */
  String id();
}

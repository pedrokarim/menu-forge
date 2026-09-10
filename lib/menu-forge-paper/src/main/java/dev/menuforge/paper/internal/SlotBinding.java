package dev.menuforge.paper.internal;

import dev.menuforge.model.Slot;
import dev.menuforge.paper.api.ListEntry;

/**
 * Ce qui occupe un slot de l’inventaire affiché.
 *
 * @param slot    slot du format
 * @param enabled {@code enabledWhen} vrai au moment de la construction
 * @param entry   entrée de liste affichée (slots {@code list}), ou {@code null}
 */
record SlotBinding(Slot slot, boolean enabled, ListEntry entry) {
}

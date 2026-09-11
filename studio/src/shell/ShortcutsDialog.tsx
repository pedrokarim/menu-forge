import { Fragment } from 'react';
import { Modal } from '../components/fields';
import { ShortcutKeys } from '../ui/Keys';

/** Une ligne : touches et gestes séparés par « + » (« Ctrl+Z », « Espace+Glisser »). */
interface Entry {
  keys: string;
  label: string;
}

const GROUPS: ReadonlyArray<{ title: string; entries: Entry[] }> = [
  {
    title: 'Navigation',
    entries: [
      { keys: 'Ctrl+1', label: 'Accueil' },
      { keys: 'Ctrl+2', label: 'Éditeur' },
      { keys: 'Ctrl+3', label: 'Bibliothèques' },
      { keys: 'Ctrl+4', label: 'Paramètres' },
      { keys: 'Ctrl+5', label: 'À propos' },
      { keys: 'Ctrl+O', label: 'Changer d’espace de travail' },
      { keys: '?', label: 'Cet aide-mémoire' },
    ],
  },
  {
    title: 'Sélection et presse-papiers',
    entries: [
      { keys: 'Maj+Clic', label: 'Ajouter à la sélection ou en retirer (Ctrl+Clic aussi)' },
      { keys: 'Glisser', label: 'Sur une zone vide : sélection au rectangle' },
      { keys: 'Ctrl+A', label: 'Tout sélectionner (sauf verrouillé ou masqué)' },
      { keys: 'Échap', label: 'Désélectionner' },
      { keys: 'Suppr', label: 'Supprimer la sélection' },
      { keys: 'Ctrl+D', label: 'Dupliquer la sélection' },
      { keys: 'Ctrl+C', label: 'Copier' },
      { keys: 'Ctrl+X', label: 'Couper' },
      { keys: 'Ctrl+V', label: 'Coller (éléments, ou image PNG copiée)' },
    ],
  },
  {
    title: 'Éditeur de menus',
    entries: [
      { keys: 'V', label: 'Outil Sélection' },
      { keys: 'S', label: 'Outil Slots' },
      { keys: 'Flèches', label: 'Déplacer de 1 px (zones : une case)' },
      { keys: 'Maj+Flèches', label: 'Déplacer de 18 px (une case)' },
      { keys: 'Ctrl+S', label: 'Enregistrer' },
    ],
  },
  {
    title: 'Éditeur d’assets',
    entries: [
      { keys: 'V', label: 'Outil Sélection' },
      { keys: 'B', label: 'Outil Box' },
      { keys: 'T', label: 'Outil Texte' },
      { keys: 'I', label: 'Outil Image' },
      { keys: 'Ctrl+G', label: 'Grouper la sélection' },
      { keys: 'Ctrl+Maj+G', label: 'Dégrouper' },
      { keys: 'Double-clic', label: 'Un seul élément d’un groupe' },
      { keys: 'Maj+Flèches', label: 'Déplacer de 10 px' },
      { keys: 'Ctrl+S', label: 'Enregistrer et exporter' },
    ],
  },
  {
    title: 'Toile',
    entries: [
      { keys: 'Ctrl+Z', label: 'Annuler' },
      { keys: 'Ctrl+Y', label: 'Rétablir' },
      { keys: 'Ctrl+0', label: 'Ajuster le zoom' },
      { keys: 'Ctrl+Molette', label: 'Zoomer sur le pointeur' },
      { keys: 'Espace+Glisser', label: 'Faire défiler la toile' },
      { keys: 'Clic molette', label: 'Faire défiler la toile' },
      { keys: 'Alt+Glisser', label: 'Glisser sans aimantation' },
      { keys: 'Clic droit', label: 'Actions de l’élément visé (ou de la sélection)' },
      { keys: 'Glisser', label: 'Un PNG depuis l’explorateur : nouvelle couche ou image' },
    ],
  },
];

/** Aide-mémoire des raccourcis (touche « ? »), regroupé par contexte. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Raccourcis clavier"
      wide
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <div className="shortcut-groups">
        {GROUPS.map((group) => (
          <section key={group.title} className="shortcut-group">
            <h3>{group.title}</h3>
            <dl className="shortcut-list">
              {group.entries.map((entry) => (
                <Fragment key={`${entry.keys}-${entry.label}`}>
                  <dt>
                    <ShortcutKeys shortcut={entry.keys} />
                  </dt>
                  <dd>{entry.label}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}

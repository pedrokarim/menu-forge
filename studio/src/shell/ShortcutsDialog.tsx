import { Fragment } from 'react';
import { Modal } from '../components/fields';
import { ArrowKeys, ShortcutKeys } from '../ui/Keys';

/** Une ligne : touches (« Ctrl+Z ») ou geste décrit en clair (« Ctrl + molette »). */
type Entry = { keys: string; label: string } | { arrows: true; label: string } | { gesture: string; label: string };

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
    title: 'Éditeur de menus',
    entries: [
      { keys: 'V', label: 'Outil Sélection' },
      { keys: 'S', label: 'Outil Slots' },
      { keys: 'Suppr', label: 'Supprimer l’élément' },
      { keys: 'Ctrl+D', label: 'Dupliquer la couche (ou l’élément)' },
      { keys: 'Échap', label: 'Désélectionner' },
      { arrows: true, label: 'Déplacer de 1 px' },
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
      { gesture: 'Ctrl + molette', label: 'Zoomer sur le pointeur' },
      { gesture: 'Espace + glisser', label: 'Faire défiler la toile' },
      { gesture: 'Clic molette', label: 'Faire défiler la toile' },
      { gesture: 'Alt en glissant', label: 'Sans aimantation' },
    ],
  },
];

/** Aide-mémoire des raccourcis (touche « ? »), regroupé par contexte. */
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
                <Fragment key={`${'keys' in entry ? entry.keys : 'gesture' in entry ? entry.gesture : 'arrows'}-${entry.label}`}>
                  <dt>
                    {'keys' in entry && <ShortcutKeys shortcut={entry.keys} />}
                    {'arrows' in entry && <ArrowKeys />}
                    {'gesture' in entry && <span className="shortcut-gesture">{entry.gesture}</span>}
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

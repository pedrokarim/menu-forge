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
    title: 'Éditeur de menus',
    entries: [
      { keys: 'V', label: 'Outil Sélection' },
      { keys: 'S', label: 'Outil Slots' },
      { keys: 'Suppr', label: 'Supprimer l’élément' },
      { keys: 'Ctrl+D', label: 'Dupliquer la couche (ou l’élément)' },
      { keys: 'Échap', label: 'Désélectionner' },
      { keys: 'Flèches', label: 'Déplacer de 1 px' },
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
    title: 'Éditeur de pixels',
    entries: [
      { keys: 'B', label: 'Crayon' },
      { keys: 'E', label: 'Gomme' },
      { keys: 'G', label: 'Pot de peinture' },
      { keys: 'I', label: 'Pipette' },
      { keys: 'L', label: 'Ligne' },
      { keys: 'U', label: 'Rectangle' },
      { keys: 'Maj+U', label: 'Ellipse' },
      { keys: 'M', label: 'Sélection rectangulaire' },
      { keys: 'Q', label: 'Lasso' },
      { keys: 'W', label: 'Baguette magique' },
      { keys: 'V', label: 'Déplacement' },
      { keys: 'X', label: 'Échanger les couleurs' },
      { keys: '1', label: 'Brosse de 1 px (2, 3, 4 : plus grande)' },
      { keys: 'Alt+Clic', label: 'Pipette temporaire' },
      { keys: 'Maj+Clic', label: 'Ligne depuis le dernier point' },
      { keys: 'Ctrl+A', label: 'Tout sélectionner' },
      { keys: 'Ctrl+D', label: 'Désélectionner' },
      { keys: 'Ctrl+Maj+I', label: 'Inverser la sélection' },
      { keys: 'Ctrl+C', label: 'Copier' },
      { keys: 'Ctrl+X', label: 'Couper' },
      { keys: 'Ctrl+V', label: 'Coller (image du système comprise)' },
      { keys: 'Suppr', label: 'Vider la sélection' },
      { keys: 'Entrée', label: 'Poser le contenu déplacé' },
      { keys: 'Flèches', label: 'Déplacer la sélection de 1 px' },
      { keys: 'Maj+Flèches', label: 'Déplacer la sélection de 8 px' },
      { keys: 'Maj+H', label: 'Retourner horizontalement' },
      { keys: 'Maj+V', label: 'Retourner verticalement' },
      { keys: 'Maj+R', label: 'Pivoter de 90°' },
      { keys: 'Ctrl+J', label: 'Dupliquer le calque' },
      { keys: 'Ctrl+E', label: 'Fusionner vers le bas' },
      { keys: 'Maj+G', label: 'Grille des pixels' },
      { keys: 'Ctrl++', label: 'Zoom avant' },
      { keys: 'Ctrl+-', label: 'Zoom arrière' },
      { keys: 'Molette', label: 'Faire défiler (Maj : horizontalement)' },
      { keys: 'Ctrl+S', label: 'Enregistrer et exporter le PNG' },
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
      { keys: 'Clic droit', label: 'Actions de l’élément visé' },
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

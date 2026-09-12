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
      { keys: 'Glisser', label: 'Sur une zone vide : sélection au rectangle' },
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
      { keys: 'E', label: 'Essayer le menu (Échap pour revenir à l’édition)' },
      { keys: 'Retour arrière', label: 'En essai : revenir au menu précédent' },
      { keys: 'Alt+↑', label: 'Monter l’action ciblée (Alt+↓ : descendre)' },
      { keys: 'Flèches', label: 'Déplacer de 1 px (zones : une case)' },
      { keys: 'Maj+Flèches', label: 'Déplacer de 18 px (une case)' },
      { keys: 'Ctrl+S', label: 'Enregistrer' },
      { keys: 'Ctrl+E', label: 'Exporter vers le plugin' },
      { keys: 'Ctrl+Maj+E', label: 'Exporter un pack ZIP de test' },
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
      { keys: 'Ctrl++', label: 'Zoom avant (+ seul aussi)' },
      { keys: 'Ctrl+-', label: 'Zoom arrière (- seul aussi)' },
      { keys: 'Molette', label: 'Faire défiler (Maj : horizontalement)' },
      { keys: 'Ctrl+S', label: 'Enregistrer et exporter le PNG' },
    ],
  },
  {
    title: 'Toile',
    entries: [
      { keys: 'Ctrl+Z', label: 'Annuler' },
      { keys: 'Ctrl+Y', label: 'Rétablir' },
      { keys: 'Z', label: 'Outil Zoom (maintenu : le temps de l’appui)' },
      { keys: 'Alt+Clic', label: 'Outil Zoom : zoom arrière (glisser : zoomer sur la zone)' },
      { keys: '+', label: 'Zoom avant' },
      { keys: '-', label: 'Zoom arrière' },
      { keys: 'Maj+0', label: 'Taille réelle (×1)' },
      { keys: 'Maj+1', label: 'Ajuster à la fenêtre (Ctrl+0 aussi)' },
      { keys: 'Maj+2', label: 'Zoomer sur la sélection' },
      { keys: 'Ctrl+Molette', label: 'Zoomer sur le pointeur' },
      { keys: 'Espace+Glisser', label: 'Faire défiler la toile' },
      { keys: 'Clic molette', label: 'Faire défiler la toile' },
      { keys: 'Alt+Glisser', label: 'Glisser sans aimantation' },
      { keys: 'Clic droit', label: 'Actions de l’élément visé (ou de la sélection)' },
      { keys: 'Glisser', label: 'Un PNG depuis l’explorateur : nouvelle couche ou image' },
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

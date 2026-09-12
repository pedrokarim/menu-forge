# Raccourcis clavier

Tous les raccourcis du studio, groupés comme dans son aide-mémoire (touche
`?`, fichier [`ShortcutsDialog.tsx`](../studio/src/shell/ShortcutsDialog.tsx)).
« Maj » est la touche Majuscule.

![L’aide-mémoire des raccourcis du studio, ouvert avec la touche « ? »](../site/assets/screens/shortcuts.png)

Quelques règles valent partout :

- les **lettres** sont lues sur la touche produite (en AZERTY, `A` est la
  touche marquée A) et les **chiffres** sur la touche physique (`Ctrl+1` marche
  en AZERTY sans Maj) ;
- un raccourci d’une seule touche (`V`, `E`, `+`…) ne s’applique ni pendant la
  saisie dans un champ, ni quand un dialogue ou un menu contextuel est ouvert ;
- `Échap` ferme le dialogue ou le menu contextuel ouvert.

## Navigation

| Touches | Action |
|---|---|
| `Ctrl+1` | Accueil |
| `Ctrl+2` | Éditeur |
| `Ctrl+3` | Bibliothèques |
| `Ctrl+4` | Paramètres |
| `Ctrl+5` | À propos |
| `Ctrl+O` | Changer d’espace de travail |
| `?` | L’aide-mémoire des raccourcis |

## Sélection et presse-papiers

Dans l’éditeur de menus et l’éditeur d’assets (l’éditeur de pixels a les
siens, plus bas).

| Touches | Action |
|---|---|
| `Maj+Clic` | Ajouter à la sélection ou en retirer (`Ctrl+Clic` aussi) |
| `Glisser` | Sur une zone vide : sélection au rectangle |
| `Ctrl+A` | Tout sélectionner (sauf ce qui est verrouillé ou masqué) |
| `Échap` | Désélectionner |
| `Suppr` | Supprimer la sélection |
| `Ctrl+D` | Dupliquer la sélection |
| `Ctrl+C` | Copier |
| `Ctrl+X` | Couper |
| `Ctrl+V` | Coller (des éléments, ou une image PNG copiée) |

## Éditeur de menus

| Touches | Action |
|---|---|
| `V` | Outil Sélection |
| `S` | Outil Slots |
| `E` | Essayer le menu (`Échap` pour revenir à l’édition) |
| `Retour arrière` | En essai : revenir au menu précédent |
| `Alt+↑` | Monter l’action ciblée (`Alt+↓` : descendre) |
| `Flèches` | Déplacer de 1 px (une zone de slots : d’une case) |
| `Maj+Flèches` | Déplacer de 18 px (une case) |
| `Ctrl+S` | Enregistrer |
| `Ctrl+E` | Exporter vers le plugin |
| `Ctrl+Maj+E` | Exporter un pack ZIP de test |

`Ctrl+Maj+Z` rétablit aussi, comme `Ctrl+Y`.

## Éditeur de formulaires Bedrock

| Touches | Action |
|---|---|
| `E` | Essayer le formulaire (`Échap` pour revenir à l’édition) |
| `Retour arrière` | En essai : revenir au formulaire précédent |
| `Alt+↑` | Monter le bouton sélectionné (`Alt+↓` : descendre) |
| `Suppr` | Supprimer le bouton sélectionné (`Retour arrière` aussi, hors essai) |
| `+` | Aperçu : zoom avant (`-` : arrière) |
| `Maj+0` | Aperçu : taille réelle (×1) |
| `Maj+1` | Aperçu : ajuster à la zone |
| `Maj+2` | Aperçu : zoomer sur le bouton sélectionné |

`Ctrl+Z` et `Ctrl+Y` annulent et rétablissent, comme dans l’éditeur de menus.

## Éditeur d’assets

| Touches | Action |
|---|---|
| `V` | Outil Sélection |
| `B` | Outil Box |
| `T` | Outil Texte |
| `I` | Outil Image |
| `Ctrl+G` | Grouper la sélection |
| `Ctrl+Maj+G` | Dégrouper |
| `Double-clic` | Un seul élément d’un groupe |
| `Maj+Flèches` | Déplacer de 10 px |
| `Ctrl+S` | Enregistrer et exporter |

## Éditeur de pixels

| Touches | Action |
|---|---|
| `B` | Crayon |
| `E` | Gomme |
| `G` | Pot de peinture |
| `I` | Pipette |
| `L` | Ligne |
| `U` | Rectangle |
| `Maj+U` | Ellipse |
| `M` | Sélection rectangulaire |
| `Q` | Lasso |
| `W` | Baguette magique |
| `V` | Déplacement |
| `X` | Échanger les couleurs |
| `1` | Brosse de 1 px (`2`, `3`, `4` : plus grande) |
| `Alt+Clic` | Pipette temporaire |
| `Maj+Clic` | Ligne depuis le dernier point |
| `Ctrl+A` | Tout sélectionner |
| `Ctrl+D` | Désélectionner |
| `Ctrl+Maj+I` | Inverser la sélection |
| `Ctrl+C` | Copier |
| `Ctrl+X` | Couper |
| `Ctrl+V` | Coller (image du presse-papiers du système comprise) |
| `Suppr` | Vider la sélection |
| `Entrée` | Poser le contenu déplacé |
| `Flèches` | Déplacer la sélection de 1 px |
| `Maj+Flèches` | Déplacer la sélection de 8 px |
| `Maj+H` | Retourner horizontalement |
| `Maj+V` | Retourner verticalement |
| `Maj+R` | Pivoter de 90° |
| `Ctrl+J` | Dupliquer le calque |
| `Ctrl+E` | Fusionner vers le bas |
| `Maj+G` | Grille des pixels |
| `Ctrl++` | Zoom avant (`+` seul aussi) |
| `Ctrl+-` | Zoom arrière (`-` seul aussi) |
| `Molette` | Faire défiler (`Maj` : horizontalement) |
| `Ctrl+S` | Enregistrer et exporter le PNG |

Dans l’éditeur de pixels, `Ctrl+D` désélectionne : la duplication de calque
est sur `Ctrl+J`. Les outils eux-mêmes sont décrits dans
[`pixels.md`](pixels.md#éditeur).

## Toile

Dans les trois toiles (menus, assets, pixels). `+`, `-`, `Maj+0`, `Maj+1` et
`Maj+2` servent aussi à l’aperçu des formulaires Bedrock.

| Touches | Action |
|---|---|
| `Ctrl+Z` | Annuler |
| `Ctrl+Y` | Rétablir |
| `Z` | Outil Zoom (maintenu : le temps de l’appui) |
| `Alt+Clic` | Outil Zoom : zoom arrière (glisser : zoomer sur la zone) |
| `+` | Zoom avant |
| `-` | Zoom arrière |
| `Maj+0` | Taille réelle (×1) |
| `Maj+1` | Ajuster à la fenêtre (`Ctrl+0` aussi) |
| `Maj+2` | Zoomer sur la sélection |
| `Ctrl+Molette` | Zoomer sur le pointeur |
| `Espace+Glisser` | Faire défiler la toile |
| `Clic molette` | Faire défiler la toile |
| `Alt+Glisser` | Glisser sans aimantation |
| `Clic droit` | Actions de l’élément visé (ou de la sélection) |
| `Glisser` | Un PNG depuis l’explorateur : nouvelle couche ou image |

## Colonnes latérales

Les colonnes de gauche et de droite des quatre éditeurs se règlent à la
souris ou au clavier, par la poignée de leur bord (voir
[`screens.md`](screens.md#fenêtre-colonnes-et-notifications)). La largeur
choisie est gardée d’une session à l’autre.

| Touches | Action |
|---|---|
| `Glisser` | Régler la largeur (la toile suit en direct) |
| `Double-clic` | Rétablir la largeur par défaut (`Entrée` aussi, poignée ciblée) |
| `←`, `→` | Élargir ou rétrécir de 8 px (`Maj` : de 32 px) |
| `Début`, `Fin` | Largeur minimale, largeur maximale |

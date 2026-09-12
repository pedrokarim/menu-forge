# Format `*.pixel.json` (version 1) – éditeur de pixels

Une **image de pixels** se dessine au pixel près dans le studio (mode
« Pixels » de l’éditeur, adresse `#/editeur/pixels/<id>`). Elle garde ses
**calques** dans un document source et, à chaque enregistrement, exporte un
**PNG aplati** dans `textures/` : il s’emploie tel quel comme couche d’un menu
ou comme image d’un asset.

| Fichier | Rôle |
|---|---|
| `pixels/<id>.pixel.json` | Document source : nom, taille, calques, texture d’export |
| `textures/<export.texture>` | PNG aplati, réécrit à chaque enregistrement (par défaut `textures/pixels/<id>.png`) |

## Pourquoi les calques sont dans le JSON

Chaque calque est un PNG encodé en base64 **dans** le document, plutôt qu’un
fichier voisin :

- un seul fichier par image, écrit d’un bloc (écriture atomique) : jamais de
  calque orphelin ni de document qui désigne un PNG disparu ;
- une seule vérification de chemin côté backend (le document, sous `pixels/`) ;
- le document se copie, se renomme ou se versionne comme un tout.

Le prix : environ un tiers de taille en plus pour les calques, acceptable pour
des images de 1024 px au plus.

## Exemple

```json
{
  "formatVersion": 1,
  "id": "epee",
  "name": "Épée",
  "size": { "width": 16, "height": 16 },
  "layers": [
    { "id": "calque_1", "name": "Contour", "visible": true, "opacity": 100, "png": "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQ…" },
    { "id": "calque_2", "name": "Reflets", "visible": true, "opacity": 60, "png": "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQ…" }
  ],
  "export": { "texture": "pixels/epee.png" },
  "source": { "kind": "library", "library": "vanilla", "path": "assets/minecraft/textures/item/iron_sword.png" }
}
```

## Racine

| Clé | Rôle |
|---|---|
| `formatVersion` | `1` |
| `id` | `[a-z0-9_]`, nom du fichier `pixels/<id>.pixel.json` |
| `name` | Nom lisible (texte non vide) |
| `size` | `width`, `height` en pixels, entiers de 1 à 1024 |
| `layers` | De 1 à 64 calques, **du dessous vers le dessus** (le dernier est dessiné au-dessus) |
| `export` | `texture` : chemin du PNG aplati, relatif à `textures/` |
| `source` | Facultatif, pour information : la texture d’où l’image a été créée (voir plus bas) |

## Calques

| Clé | Rôle |
|---|---|
| `id` | `[a-z0-9_]`, unique dans l’image (`calque_1`, `calque_2`…) |
| `name` | Nom affiché (texte) |
| `visible` | `true` ou `false` : un calque masqué n’est ni affiché ni exporté |
| `opacity` | Entier de 0 à 100 (pourcentage) |
| `png` | PNG du calque encodé en base64 (sans préfixe `data:`), exactement `size.width × size.height` |

Le studio écrit des PNG RGBA 8 bits. Il les encode et les décode lui-même,
sans passer par un canvas (qui prémultiplie l’alpha) : les pixels translucides
gardent leur couleur exacte d’un enregistrement à l’autre.

## Export

Le PNG aplati est la superposition des calques **visibles**, de bas en haut,
chacun avec son opacité (mélange « par-dessus », non prémultiplié). Le contenu
d’une sélection déplacée ou collée (« flottant ») est posé à sa place. Le PNG
fait la taille de l’image.

`export.texture` doit finir par `.png` et rester sous `textures/` : pas de chemin
absolu, pas de lecteur (`C:`), pas de `..`. Par défaut `pixels/<id>.png` ; on
peut le changer dans le panneau « Image » (par exemple pour réécrire la texture
d’une couche de menu).

## Ouvrir une texture existante

« Ouvrir dans l’éditeur de pixels » (menu contextuel d’une vignette de la
bibliothèque, ou d’une couche de menu) crée une image d’un seul calque :

| Texture | Texture d’export de l’image | `source` |
|---|---|---|
| Vignette d’une bibliothèque (pack branché) | `pixels/<id>.png` : une **copie**, le pack n’est jamais modifié | `{ "kind": "library", "library": "<id>", "path": "assets/…" }` |
| Couche dont la texture est sous `library/`, `generated/` ou `assets/` | `pixels/<id>.png` (copie : ces PNG sont réimportés ou régénérés par le studio) | `{ "kind": "texture", "texture": "…" }` |
| Autre texture de l’espace (`imported/`, `cropped/`, `pixels/`…) | La texture elle-même : chaque enregistrement la réécrit, la couche suit | `{ "kind": "texture", "texture": "…" }` |

Si une image exporte déjà vers cette texture, elle est rouverte au lieu d’en
créer une nouvelle. Une texture de plus de 1024 px de côté est refusée.

## Backend

| Route | Rôle |
|---|---|
| `GET /api/pixels` | Résumés, sans les calques : `[{ id, name, width, height, layers, texture, modified }]` |
| `GET /api/pixels/:id` | Le document complet (404 « Image introuvable » s’il manque) |
| `PUT /api/pixels/:id` | Enregistre le document (204), écriture atomique |

À l’enregistrement, le backend refuse (400) tout document dont l’`id` ne
correspond pas à l’adresse, dont la taille sort de 1 à 1024, qui n’a pas de 1 à
64 calques d’identifiants uniques, dont un calque n’est pas un PNG en base64
**de la taille de l’image** (en-tête `IHDR` lu), ou dont `export.texture` sort
de `textures/`. L’identifiant de l’adresse suit la règle des menus et des assets
(`[a-z0-9_]`) : aucun fichier ne peut être écrit hors de `pixels/`. Le PNG
aplati passe par la route habituelle des textures (`PUT /api/textures/…`), qui
refuse elle aussi toute sortie de `textures/`.

Les images apparaissent dans les documents récents (`GET /api/documents/recent`,
`type` : `"pixel"`, avec `texture` pour la vignette de l’accueil).

## Éditeur

| Outil | Touche | Détails |
|---|---|---|
| Crayon | `B` | Brosse carrée de 1 à 4 px (`1` à `4`) ; « pixel parfait » à 1 px ; `Maj`+clic : ligne depuis le dernier point |
| Gomme | `E` | Rend les pixels transparents |
| Pot de peinture | `G` | Zone contiguë ou toute l’image, tolérance de 0 à 255 par canal |
| Pipette | `I` | Couleur affichée ou du calque actif ; `Maj`+clic : couleur secondaire ; `Alt`+clic avec un outil de dessin |
| Ligne | `L` | Bresenham (pas de pixel en double) ; `Maj` : angles de 45° |
| Rectangle, ellipse | `U`, `Maj+U` | Contour (épaisseur de la brosse) ou plein ; `Maj` : carré, cercle |
| Sélection rectangulaire, lasso, baguette | `M`, `Q`, `W` | `Maj` : ajouter ; `Alt` : retirer ; glisser dans la sélection : la déplacer |
| Déplacement | `V` | La sélection (ou tout le calque) ; `Ctrl` : en copie ; flèches : 1 px (`Maj` : 8 px) |
| Zoom | `Z` | Clic : zoom avant ; `Alt`+clic : arrière ; glisser : cadrer la zone ; `Z` maintenu : le temps d’un geste |

Et aussi : couleurs principale et secondaire (échangeables), saisie
`#rrggbb` ou `#rrggbbaa`, palette par défaut (tons de l’interface de Minecraft,
du thème Deepslate, 16 couleurs du chat), couleurs récentes et couleurs du
document ; symétrie horizontale et verticale ; grille des pixels ; zoom de ×1
à ×64 ; défilement ; calques (ajouter, dupliquer, supprimer, réordonner,
visibilité, opacité, fusionner vers le bas) ; copier, couper, coller (image
du presse-papiers du système comprise), retourner, pivoter, vider la
sélection ; taille de l’image (agrandir ou recadrer la toile avec un ancrage,
ou mise à l’échelle au plus proche voisin), recadrer à la sélection, rogner
les bords transparents ; annuler, rétablir. Tous les raccourcis :
[`shortcuts.md`](shortcuts.md#éditeur-de-pixels).

Limites : 1024 px de côté, 64 calques ; l’historique garde environ 256 Mo de
calques modifiés (de 16 à 100 pas selon la taille de l’image).

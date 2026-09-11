# Format `*.menu.json` (version 1)

Le contrat entre le studio (qui l’écrit) et la lib (qui le lit). Un fichier par
menu. Toutes les clés sont en anglais ; les textes affichés sont libres.

Coordonnées : **pixels fenêtre** (voir [`rendering.md`](rendering.md) § 2).
Positions de slots : **colonne / ligne** de la grille du coffre.

## Exemple complet

```json
{
  "formatVersion": 1,
  "id": "badges",
  "name": "Succès",
  "extends": ["navigation"],
  "container": { "type": "chest", "rows": 6 },

  "state": {
    "tab": { "type": "enum", "values": ["progress", "discovery", "challenge"], "default": "progress" },
    "page": { "type": "page", "list": "badges" }
  },

  "layers": [
    { "id": "background", "texture": "badges/background.png", "x": 0, "y": 33 },
    {
      "id": "tab_progress_on", "texture": "badges/tab_on.png", "x": 7, "y": 38,
      "visibleWhen": { "state": "tab", "is": "progress" }
    },
    {
      "id": "next_page_on", "texture": "common/next_page_on.png", "x": 98, "y": 111,
      "visibleWhen": { "flag": "page.hasNext" }
    }
  ],

  "texts": [
    {
      "id": "page_label", "x": 88, "y": 116, "align": "center",
      "color": "#404040", "value": "{page.number}/{page.count}"
    }
  ],

  "slots": [
    {
      "id": "tab_progress", "kind": "button", "area": { "col": 0, "row": 1 },
      "item": { "invisible": true, "name": "<green>Progression" },
      "onClick": [{ "type": "setState", "state": "tab", "value": "progress" }]
    },
    {
      "id": "grid", "kind": "list", "list": "badges",
      "area": { "col": 2, "row": 2, "width": 6, "height": 3 }
    },
    {
      "id": "next", "kind": "button", "area": { "col": 6, "row": 5 },
      "item": { "invisible": true, "name": "<gray>Page suivante" },
      "enabledWhen": { "flag": "page.hasNext" },
      "onClick": [{ "type": "nextPage", "list": "badges" }]
    }
  ]
}
```

## Racine

| Clé | Type | Rôle |
|---|---|---|
| `formatVersion` | entier | `1` |
| `id` | chaîne `[a-z0-9_]` | Identifiant unique, sert aussi de nom de police |
| `name` | chaîne | Nom lisible (outil, logs) |
| `extends` | liste d’ids | Gabarits dont on hérite (§ Gabarits) |
| `container` | objet | `type: "chest"`, `rows` de 1 à 6 |
| `state` | objet | Variables d’état du menu (§ État) |
| `layers` | liste | Images du titre, de bas en haut (§ Couches) |
| `texts` | liste | Textes dynamiques du titre (§ Textes) |
| `slots` | liste | Zones de slots et leur comportement (§ Slots) |

## Couches (`layers`)

| Clé | Rôle |
|---|---|
| `id` | Identifiant unique dans le menu |
| `texture` | Chemin du PNG, relatif au dossier `textures/` du projet |
| `x`, `y` | Position du coin haut-gauche, en pixels fenêtre |
| `visibleWhen` | Condition (§ Conditions) ; absente = toujours visible |
| `generator` | Paramètres de la texture si elle a été générée par le studio |
| `editor` | État dans l’éditeur (§ Métadonnées de l’éditeur), ignoré par la lib |

La lib recadre l’image, calcule son avance et génère le glyphe. L’ordre de la
liste est l’ordre d’empilement : la dernière couche est au-dessus.

`generator` est une **métadonnée du studio** : elle permet de rééditer une
texture générée (style, taille, couleur, cellules dessinées). La lib l’ignore et
ne lit que le PNG pointé par `texture`.

```json
"generator": {
  "style": "panel", "width": 176, "height": 127, "color": "#c6c6c6",
  "cells": [{ "col": 0, "row": 1, "width": 9, "height": 5 }]
}
```

Styles : `panel` (panneau biseauté façon vanilla), `button` (bouton coloré),
`cell` (cellule de slot), `veil` (voile de modale, couleur avec alpha),
`flat` (aplat).

## Textes (`texts`)

| Clé | Rôle |
|---|---|
| `id` | Identifiant |
| `x`, `y` | Point d’ancrage (haut du texte), pixels fenêtre |
| `align` | `left` (défaut), `center`, `right` par rapport à `x` |
| `color` | Couleur hexadécimale |
| `value` | Texte avec variables `{…}` (§ Variables) |
| `visibleWhen` | Condition |
| `editor` | État dans l’éditeur (§ Métadonnées de l’éditeur) |

## Slots (`slots`)

| Clé | Rôle |
|---|---|
| `id` | Identifiant |
| `kind` | `button`, `list`, `input` ou `decoration` |
| `area` | `col`, `row`, et optionnellement `width`, `height` (défaut 1) |
| `item` | Item affiché (§ Items) ; pour `list`, fourni par la source |
| `onClick` | Liste d’actions (§ Actions) |
| `visibleWhen` | Le slot est vide si la condition est fausse |
| `enabledWhen` | Le slot est affiché mais ne réagit pas si la condition est fausse |
| `editor` | État dans l’éditeur (§ Métadonnées de l’éditeur) |

Types de slots :

- **`button`** : même item et mêmes actions sur toute l’`area` (un bouton 2×2
  couvre 4 slots).
- **`list`** : remplie par une **source de données** nommée (`list`), fournie en
  Java par le serveur. La lib gère la pagination.
- **`input`** : le joueur peut y déposer et y retirer un item (tout le reste du
  menu est verrouillé).
- **`decoration`** : item affiché, jamais cliquable.

## Métadonnées de l’éditeur (`editor`)

Couches, textes et slots peuvent porter une clé `editor`, **métadonnée du
studio** comme `generator` : la lib l’ignore, l’élément reste exporté,
affiché et cliquable en jeu.

```json
"editor": { "locked": true, "hidden": true }
```

| Clé | Rôle dans le studio |
|---|---|
| `locked` | Verrouillé : ne se sélectionne plus sur la toile (il reste dans la liste des éléments) |
| `hidden` | Masqué sur la toile de l’éditeur seulement (le titre composé et le jeu l’affichent toujours) |

Une clé absente vaut `false` ; `editor` disparaît quand elle est vide. Un
élément collé ou dupliqué n’hérite pas de ces drapeaux.

La lib ignore toute clé inconnue (voir `MenuParser`) : le test
`MenuParserTest.ignoresTheStudioEditorFlags` le vérifie pour `editor`.

## Items

```json
{ "invisible": true, "name": "<gold>Boutique", "lore": ["<gray>Ouvre la boutique"] }
{ "material": "PLAYER_HEAD", "head": "{viewer}", "name": "{viewer.name}" }
{ "ref": "enderium:empty_button" }
```

`name` et `lore` sont en MiniMessage et acceptent les variables. `invisible`
demande à la lib un item sans rendu (le bouton est dessiné par une couche).
`ref` délègue la création de l’item à l’adaptateur du serveur.

## État (`state`)

| Type | Rôle |
|---|---|
| `enum` | Une valeur parmi `values`, `default` requis |
| `bool` | `default` requis |
| `int` | `default`, `min`, `max` optionnels |
| `page` | Page courante de la liste `list` ; expose `page.number`, `page.count`, `page.hasPrev`, `page.hasNext` |

L’état vit **par joueur et par ouverture**. Changer l’état recompose le titre et
les slots. Minecraft ne permettant pas de changer le titre d’un inventaire
ouvert, la lib rouvre le même coffre : le curseur du joueur ne bouge pas.

## Conditions

```json
{ "state": "tab", "is": "progress" }
{ "state": "tab", "in": ["progress", "discovery"] }
{ "flag": "page.hasNext" }
{ "flag": "viewer.isStaff" }
{ "all": [ … ] }   { "any": [ … ] }   { "not": { … } }
```

Un `flag` est un booléen fourni par la lib (`page.*`) ou par le serveur
(`viewer.*`, drapeaux custom).

## Actions

| `type` | Paramètres | Effet |
|---|---|---|
| `open` | `menu`, `state?` | Ouvre un autre menu (empilé : `back` y revient) |
| `back` | – | Revient au menu précédent, ou ferme |
| `close` | – | Ferme l’inventaire |
| `setState` | `state`, `value` | Change une variable d’état |
| `nextPage` / `prevPage` | `list` | Pagination |
| `sound` | `sound`, `volume?`, `pitch?` | Joue un son au joueur |
| `command` | `command`, `as`: `player` ou `console` | Exécute une commande |
| `custom` | `id`, `args?` | Transmis à l’adaptateur du serveur |

`custom` est la porte vers l’infrastructure du serveur : dans enderium-core,
l’adaptateur y branche les ClickActions existantes.

## Variables

Syntaxe `{nom}` dans `name`, `lore` et `value` :

- `{viewer.name}`, `{viewer.uuid}` ;
- `{page.number}`, `{page.count}` ;
- `{state.<nom>}` ;
- tout autre nom est demandé à l’adaptateur (placeholders du serveur).

## Gabarits

Un gabarit est un fichier du même format avec `"template": true`. `extends`
fusionne, dans l’ordre : `state` (clé par clé), `layers` (celles du gabarit
**sous** celles du menu), `texts` et `slots` (un `id` identique remplace celui du
gabarit).

Gabarits prévus : `navigation` (barre d’onglets flottante), `modal` (voile +
panneau + croix), `paginated-list`, `confirm`, `shop`.

## Évolutions prévues

- Schéma JSON (`docs/menu.schema.json`) généré depuis les types du studio.
- Types de conteneurs autres que le coffre (`hopper`, `dispenser`…).
- Animations (couches alternées par tick).

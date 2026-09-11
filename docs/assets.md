# Format `*.asset.json` (version 1) – mode libre

Un **asset** est une image composée librement (encart d’aide, bulle de touche,
bannière, icône avec texte…), destinée à être insérée dans du texte Minecraft
comme un glyphe (`<glyph:…>`, lang, chat, action bar, titre) ou réutilisée
comme couche d’un menu. Contrairement à un menu, il n’a ni slots ni état : c’est
une composition figée, exportée en **un PNG**.

Les assets vivent dans l’espace de travail : `assets/<id>.asset.json`, et leur
export dans `textures/assets/<id>.png`.

Schéma JSON du format : [`asset.schema.json`](asset.schema.json), vérifié par
les tests du studio (`npm test`) sur l’exemple ci-dessous.

## Exemple : l’encart d’aide du menu pause

```json
{
  "formatVersion": 1,
  "id": "help_banner",
  "name": "Encart d’aide",
  "size": { "width": 176, "height": 44 },
  "background": null,
  "elements": [
    {
      "id": "logo_box", "type": "box", "x": 0, "y": 0, "width": 44, "height": 44,
      "style": { "kind": "slice", "texture": "library/enderium_2026_03/minecraft/textures/custom/ui/menu_banner.png",
                 "source": { "x": 0, "y": 0, "width": 22, "height": 22 },
                 "insets": { "top": 3, "right": 3, "bottom": 3, "left": 3 } }
    },
    {
      "id": "logo", "type": "image", "x": 6, "y": 6,
      "texture": "library/enderium_2026_03/minecraft/textures/custom/logo_simple.png",
      "source": { "x": 0, "y": 0, "width": 128, "height": 128 }, "scale": 0.25
    },
    {
      "id": "text_box", "type": "box", "x": 48, "y": 0, "width": 128, "height": 44,
      "style": { "kind": "procedural", "preset": "panel", "color": "#3b2f2a", "border": "#2e8b86" }
    },
    {
      "id": "text", "type": "text", "x": 54, "y": 6,
      "text": "Besoin d’aide ?\nConsultez notre site web\n§5www.enderium.eu",
      "color": "#ffffff", "shadow": false, "lineHeight": 10, "align": "left"
    }
  ],
  "export": { "ascent": 7 }
}
```

## Racine

| Clé | Rôle |
|---|---|
| `formatVersion` | `1` |
| `id` | `[a-z0-9_]`, nom du fichier, du PNG exporté et du glyphe proposé |
| `name` | Nom lisible |
| `size` | `width`, `height` en pixels (1 à 1024) |
| `background` | Couleur de fond (`#rrggbbaa`) ou `null` (transparent, le cas normal) |
| `elements` | Liste d’éléments, de bas en haut (le dernier est dessiné au-dessus) |
| `groups` | Groupes d’éléments, facultatif (voir « Groupes ») |
| `export` | `ascent` du glyphe proposé (voir « Export ») |

## Éléments

Champs communs : `id`, `type`, `x`, `y` (coin haut-gauche, pixels entiers),
`hidden` (facultatif, masqué dans l’éditeur et à l’export), `locked`
(facultatif, verrouillé : ne se sélectionne plus sur la toile, reste dans la
liste des éléments ; sans effet sur l’export), `group` (facultatif,
identifiant du groupe de l’élément).

### `box`

`width`, `height`, et un `style` :

- `{ "kind": "procedural", "preset": "panel" | "button" | "cell" | "flat" | "veil", "color": "#…", "border"?: "#…" }`
  – mêmes styles Deepslate que le générateur de textures des menus (`border` remplace la
  couleur de bordure calculée) ;
- `{ "kind": "slice", "texture": "…", "source"?: { x, y, width, height }, "insets": { top, right, bottom, left } }`
  – **nine-slice** : la zone `source` de la texture (toute l’image par défaut)
  est découpée par `insets` ; les coins sont copiés tels quels, les bords et le
  centre sont **répétés** (pas étirés, pour garder des pixels nets).

### `image`

`texture` (chemin d’une texture de l’espace de travail), `source` facultatif
(zone recadrée, toute l’image par défaut), `scale` facultatif (défaut 1 ;
facteurs admis : 0.125, 0.25, 0.5, 1, 2, 3, 4 – rendu au plus proche voisin).

### `text`

`text` (plusieurs lignes séparées par `\n`, codes `§` acceptés), `color`
(défaut `#ffffff`), `shadow` (défaut `false`), `bold` (défaut `false`),
`lineHeight` (défaut 10 : 9 px de ligne + 1), `align` (`left`, `center`,
`right`, par rapport à `x`). Rendu avec la **vraie police du jeu** quand la
bibliothèque `vanilla` est branchée, sinon avec la police pixel de Menu Forge,
qui garde les avances du jeu (voir [`rendering.md`](rendering.md)).

## Groupes

Des éléments peuvent être **groupés** : ils se sélectionnent, se déplacent,
se copient, se masquent et se verrouillent ensemble. Un seul niveau (pas de
groupe dans un groupe).

```json
"groups": [{ "id": "header", "name": "En-tête" }],
"elements": [
  { "id": "frame", "type": "box", "group": "header", "x": 0, "y": 0, "width": 44, "height": 44, "style": { … } },
  { "id": "title", "type": "text", "group": "header", "x": 6, "y": 6, "text": "Aide" },
  { "id": "logo", "type": "image", "x": 50, "y": 6, "texture": "…" }
]
```

| Clé | Rôle |
|---|---|
| `groups[].id` | Identifiant du groupe (`[a-z0-9_]`), unique dans l’asset |
| `groups[].name` | Nom lisible, affiché dans la liste des éléments (facultatif ; l’identifiant sinon) |
| `elements[].group` | Groupe de l’élément (facultatif) |

- Les membres d’un groupe restent dans `elements` et y sont **contigus** : le
  groupe s’empile comme un bloc, le rendu (de bas en haut) ne change pas.
- Un groupe sans membre est retiré ; un `group` qui vise un groupe inconnu est
  ignoré (et retiré au prochain enregistrement).
- Replier un groupe dans la liste est un état de l’éditeur, pas du fichier.
- Dans le studio : `Ctrl+G` groupe la sélection, `Ctrl+Maj+G` dégroupe, un clic
  sur un membre prend tout le groupe, un double-clic ne prend que ce membre.

### Compatibilité

`groups`, `group` et `locked` sont facultatifs et `formatVersion` reste `1` :
un asset écrit avant eux s’ouvre et s’exporte à l’identique, et le PNG exporté
ne dépend ni des groupes ni du verrou.

## Export

Le studio rend l’asset à l’échelle 1 dans `textures/assets/<id>.png` et
propose les extraits prêts à coller :

```yaml
# Enderium – glyphs/*.yml
help_banner:
  texture: menu-forge/assets/help_banner
  ascent: 7
  height: 44
```

- `ascent` : position verticale du glyphe dans une ligne de texte (7 = haut de
  l’image aligné sur le haut des lettres ; plus grand = plus haut). Rappel : le
  haut de l’image est à `7 − ascent` px sous le haut de la ligne.
- `height` = hauteur du PNG (échelle 1).
- Usage dans un texte : `<glyph:help_banner>`, avec `<shift:…>` pour le placer.

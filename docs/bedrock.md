# Menu Forge sur Bedrock

Comment un menu dessiné dans le studio s’affiche sur un client **Bedrock**, et
le **contrat** entre l’exporteur du studio (« Exporter pour Bedrock ») et un
serveur Bedrock qui l’exécute (premier consommateur : le serveur Rust mc-rs).
Deux sortes de menus : les **menus coffre** du format, rendus par une
disposition générée (§ 1 à 8, mêmes menus résolus que l’export Java), et les
**formulaires Bedrock** (clé `form`, § 9), affichés dans une disposition du
pack `mcrs_ui` du serveur.

Légende : **[vu en jeu]** = vérifié sur un vrai client (Bedrock 1.26.45,
protocole 2169, essai E0) ; **[à vérifier en jeu]** = déduit, pas encore vu.

## 1. Principe

Bedrock n’a ni police par menu, ni espace d’avance négative : le fond en
glyphes du rendu Java ne se transpose pas. Menu Forge utilise à la place le
**JSON UI** du client :

1. le serveur envoie un formulaire ordinaire (`ModalFormRequest` de type
   `form`, une liste de boutons) ;
2. son **titre** porte un drapeau invisible (`§m§v`) : le pack de ressources
   aiguille alors l’écran vers une disposition dessinée au lieu de la liste
   vanilla ;
3. la disposition de chaque menu est **générée par le studio** : les couches
   en images posées au pixel, une **grille** de 9 colonnes alignée sur les
   cases du coffre, les textes ;
4. chaque case de la grille est un bouton de la collection `form_buttons` :
   son **index** vaut `colonne + 9 × ligne`, et le serveur retrouve le slot
   cliqué, puis exécute ses actions ;
5. l’état (couches et textes conditionnels) voyage dans le titre sous forme de
   **jetons**, évalués par le serveur.

Ce que l’essai E0 a établi :

| Mécanisme | Résultat |
|---|---|
| Variante de `server_form.json` activée par un drapeau de titre | [vu en jeu] |
| Fond et couches placés au pixel près (coordonnées du studio telles quelles) | [vu en jeu] |
| Couche visible ou non selon un jeton `(v)` dans le titre | [vu en jeu] |
| Titre dynamique (titre privé du drapeau et des jetons) | [vu en jeu] |
| Contrôle `grid` sur `form_buttons` : index du clic = `colonne + 9 × ligne`, image par bouton (`#form_button_texture`) | [vu en jeu] |
| Bouton envoyé avec un texte vide et sans image : invisible et inerte | [vu en jeu] |
| Boutons posés à la main avec `collection_index` | **échec** : tous renvoient l’index 0 |
| Filtrage de boutons par un jeton dans leur texte (fabrique vanilla) | **échec** : aucun bouton affiché |

Conséquence : **un bouton doit être sur des cases**. Tout ce qui est
cliquable passe par la grille ; les couches restent libres.

## 2. Ce que l’exporteur écrit

Bouton **Bedrock** de la barre d’outils de l’éditeur (ou « Exporter pour
Bedrock » dans le menu contextuel de la toile), dossier cible réglé dans
**Paramètres, Export pour Bedrock**
(`export.bedrockDirectory`). Tous les menus de l’espace sont exportés, gabarits
et composants appliqués (comme pour Java) ; les gabarits et composants eux-mêmes
ne le sont pas.

```
<dossier cible>/
├── pack/                                  le pack de ressources Bedrock
│   ├── manifest.json                      uuid stables, version incrémentée à chaque export
│   ├── ui/_ui_defs.json                   liste des fichiers ui/menu_forge/*.json
│   ├── ui/menu_forge/router.json          namespace menu_forge_router : un enfant par menu
│   ├── ui/menu_forge/<id>.json            namespace menu_forge_<id> : la disposition du menu
│   └── textures/menu_forge/<id>/<couche>.png, textures/menu_forge/_white.png,
│       textures/menu_forge/icons/…        icônes des boutons de formulaire (§ 9.3)
├── runtime.json                           le descripteur d’exécution (§ 5)
└── .menu-forge-bedrock-export.json        fichiers écrits par cet export
```

- Un export ne supprime que les fichiers listés par le manifeste de l’export
  précédent et absents du nouveau ; un fichier déposé à la main n’est jamais
  touché.
- `runtime.json` est **hors du pack** : le client ne reçoit pas la logique du
  serveur (commandes, conditions).
- La génération est **déterministe** : mêmes menus, mêmes textures et même
  version donnent les mêmes octets (`npm test`).

### 2.1 Manifest et cache du client

Le client garde un pack en cache par **uuid + version** : sans nouvelle
version, il réutilise l’ancien contenu. L’exporteur s’en charge seul :

- les uuid de l’en-tête et du module sont **dérivés** de l’espace de noms
  d’export (SHA-256 de `menu-forge:bedrock:<namespace>:header` et `…:module`),
  donc stables d’un export à l’autre ;
- avant d’écrire, le studio lit la version du pack déjà présent dans le
  dossier cible (`GET /api/export/bedrock`) et écrit la suivante
  (`[1, 0, n + 1]`, `[1, 0, 0]` au premier export) ; le backend refuse un
  pack dont la version n’est pas strictement supérieure (409) ;
- le serveur n’envoie les packs qu’à la connexion : un nouveau visuel exige que
  le joueur se reconnecte.

### 2.2 Pourquoi un pack à part, et l’accroche dans `server_form.json`

Bedrock fusionne les fichiers `ui/` de plusieurs packs **élément par
élément** : si deux packs redéfinissent la même variante de `server_form.json`,
le plus prioritaire remplace l’autre en entier. mc-rs livre déjà `mcrs_ui`, qui
redéfinit l’aiguillage de `server_form.json`. Le pack de Menu Forge ne touche
donc **pas** à `server_form.json` (mode « extension ») :

- il n’apporte que ses fichiers (`ui/menu_forge/*.json`, déclarés par son
  propre `_ui_defs.json`, que Bedrock ajoute à ceux des autres packs) et ses
  textures ;
- le serveur ajoute **une fois pour toutes** dans son `server_form.json` une
  accroche (même procédure que les autres dispositions de `mcrs_ui`) :

```json
"$flag_menu_forge": "§m§v",
{ "mcrs_menu_forge@menu_forge_router.main_panel": {
    "enabled": false, "visible": false,
    "bindings": [
      { "binding_type": "global", "binding_condition": "none",
        "binding_name": "#title_text", "binding_name_override": "#title_text" },
      { "source_property_name": "(not ((#title_text - $flag_menu_forge) = #title_text))",
        "binding_type": "view", "target_property_name": "#visible" },
      { "source_property_name": "(not ((#title_text - $flag_menu_forge) = #title_text))",
        "binding_type": "view", "target_property_name": "#enabled" } ] } }
```

plus le terme `((#title_text - $flag_menu_forge) = #title_text)` dans la
conjonction du repli vanilla (`long_form`).

Avantages : chaque export incrémente la version de **son** pack sans toucher à
celle de `mcrs_ui` ; aucun fichier écrit à la main n’est jamais écrasé par un
export ; l’accroche ne dépend que de deux noms stables, `§m§v` et
`menu_forge_router.main_panel`. Contrepartie : le pack Menu Forge doit être
servi avec le pack qui porte l’accroche (sinon la variante vise un contrôle
absent). Un mode « autonome », où le pack embarque son propre
`server_form.json`, sera nécessaire pour Geyser (étape E4), là où aucun autre
pack ne surcharge l’écran.

### 2.3 Disposition générée

`router.json` (namespace `menu_forge_router`) : un panneau plein écran avec un
voile noir (alpha 0,55), un enfant `menu_<id>@menu_forge_<id>.main_panel` par
menu, visible et actif seulement si le titre contient `[mf:<id>]`, et le bouton
de fermeture vanilla (`common.close_button`) en haut à droite.

`<id>.json` (namespace `menu_forge_<id>`) :

| Élément du menu | Contrôle JSON UI |
|---|---|
| Fenêtre | `panel` de `176 × (114 + 18 × lignes)`, centré à l’écran : mêmes coordonnées que le studio (`rendering.md` § 2) |
| Couche | `image` recadrée sur ses pixels visibles : `offset` = (`x` + recadrage, `y` + recadrage), `size` = taille visible, `layer` = rang dans le menu + 1 |
| Couche avec `visibleWhen` | la même, plus une liaison `#visible` : présente seulement si le titre contient son jeton |
| Texte sans variable | `label` figé dans le pack, couleur RVB exacte, ancré à gauche, au milieu ou à droite de (`x`, `y`) selon `align` |
| Texte avec variables (`{…}`) | `label` porté par la grille (§ 4), valeur envoyée par le serveur |
| Slots | une `grid` de `9 × (lignes + lignes de textes)` en (7, 17), cases de 18 px, `collection_name: form_buttons`, `#form_button_length` → `#maximum_grid_items` |
| Case | icône 16 × 16 (image du bouton), bouton 18 × 18 (surbrillance au survol), étiquettes des textes dynamiques |

Empilement : couches, puis textes figés, puis la grille (au-dessus de tout,
comme les items et la surbrillance d’un coffre Java).

## 3. Le titre

```
§m§v[mf:hub](3)(t0)§rHub
│   │       │  │    └─ nom du menu (repli vanilla, jamais affiché par la disposition)
│   │       │  └─ jeton d’un texte figé conditionnel visible
│   │       └─ jeton d’une couche conditionnelle visible
│   └─ jeton du menu : choisit la disposition
└─ drapeau Menu Forge : aiguille server_form vers menu_forge_router
```

- Jeton de couche : `(<rang>)`, rang de la couche dans les couches du menu
  résolu. Jeton de texte figé : `(t<rang>)`, rang dans les textes. Seuls les
  éléments **conditionnels** en ont un ; le descripteur les liste
  explicitement (§ 5), le serveur n’a pas à recalculer la règle.
- Les délimiteurs rendent les jetons non ambigus : `(1)` n’est pas une
  sous-chaîne de `(12)`, `[mf:shop]` pas une sous-chaîne de `[mf:shop_2]`.
- Le serveur retire `(`, `)`, `[` et `]` du nom avant de l’ajouter.

## 4. Les entrées du formulaire

Le serveur envoie **exactement** `9 × lignes + textes dynamiques` boutons, dans
cet ordre :

| Index | Rôle |
|---|---|
| `colonne + 9 × ligne` (0 à `9 × lignes − 1`) | la case (`colonne`, `ligne`) du coffre |
| `9 × lignes + k` | le k-ième texte dynamique du menu |

Texte d’une entrée :

| Texte envoyé | Rendu | Clic |
|---|---|---|
| `""` (sans image) | case vide, invisible | inerte |
| libellé (non vide) | icône si une image est envoyée, surbrillance au survol | renvoie l’index |
| `{x}` + libellé | icône seule, sans surbrillance | inerte (décoration, `enabledWhen` faux) |
| `{t<k>}` + valeur | aucun bouton ; l’étiquette du texte k affiche la valeur | inerte |

Le libellé d’un bouton est le nom de l’item converti en codes `§` (ou
l’identifiant du slot) ; il n’est pas affiché par la disposition, seulement par
le repli vanilla. Le serveur remplace `{` par `(` dans les libellés et `{t` par
`(t` dans les valeurs, pour qu’aucun texte ne se fasse passer pour un marqueur.
Image d’un bouton : `{"type": "path", "data": "textures/items/diamond"}`.

Chaque étiquette de texte dynamique est posée dans le modèle de case, décalée
depuis la case qui porte son entrée (connue à l’export) : seule cette case
l’affiche, grâce au marqueur `{t<k>}` [à vérifier en jeu : une étiquette qui
déborde de sa case n’est pas coupée].

## 5. Le descripteur d’exécution (`runtime.json`)

```json
{
  "format": "menu-forge-bedrock",
  "formatVersion": 1,
  "flag": "§m§v",
  "pack": { "name": "Menu Forge", "uuid": "…", "version": [1, 0, 4] },
  "warnings": ["shop : slot « sell » de type input, sans équivalent Bedrock (ignoré)"],
  "menus": [
    {
      "id": "shop",
      "name": "Boutique",
      "rows": 6,
      "entries": 55,
      "token": "[mf:shop]",
      "state": { "tab": { "type": "enum", "values": ["a", "b"], "default": "a" } },
      "tokens": [
        { "token": "(2)", "layer": "tab_a_on", "visibleWhen": { "state": "tab", "is": "a" } },
        { "token": "(t0)", "text": "hint", "visibleWhen": { "flag": "viewer.op" } }
      ],
      "texts": [
        { "id": "greeting", "entry": 54, "prefix": "{t0}", "value": "Bonjour {viewer.name}" }
      ],
      "slots": [
        {
          "id": "tab_b", "kind": "button", "cells": [1, 2], "label": "§aOnglet B", "icon": null,
          "onClick": [{ "type": "setState", "state": "tab", "value": "b" }],
          "enabledWhen": { "state": "tab", "is": "a" }
        }
      ]
    }
  ],
  "forms": []
}
```

| Clé | Rôle |
|---|---|
| `flag` | drapeau de premier niveau, identique à celui de l’accroche du pack |
| `pack` | nom, uuid et version du pack écrit avec ce descripteur (journalisés par le serveur) |
| `menus[].entries` | nombre de boutons à envoyer |
| `menus[].token` | jeton du menu dans le titre |
| `menus[].state` | variables d’état, telles que dans le format (`enum`, `bool`, `int`, `page`) |
| `menus[].tokens` | éléments figés conditionnels : le serveur ajoute `token` au titre si `visibleWhen` est vraie |
| `menus[].texts` | textes dynamiques : entrée `entry` = `prefix` + valeur interpolée si `visibleWhen` est vraie, `""` sinon |
| `menus[].slots[].cells` | index des cases couvertes par la zone, en ordre de lecture |
| `menus[].slots[].label` / `icon` | texte et image du bouton (`icon` : chemin de texture Bedrock ou `null`) |
| `menus[].slots[]` (reste) | `kind`, `list`, `onClick`, `visibleWhen`, `enabledWhen` : tels que dans le format ; seul le nom des sons est déjà traduit pour Bedrock |
| `forms` | formulaires Bedrock (§ 9.1) ; absente, aucun |

## 6. Exécution côté serveur

- **Ouvrir** : état initial (valeurs par défaut, puis `state` de l’action
  `open`, ramenées dans les bornes comme en Java), composition du titre et des
  entrées, envoi du formulaire.
- **Composer** : pour chaque slot visible, dans l’ordre du menu (un slot
  suivant qui couvre la même case la remplace) : `button` → libellé et icône,
  `{x}` si `enabledWhen` est faux ; `decoration` → `{x}` ; `list` → une case par
  élément de la page courante ; `input` → rien. Les conditions sont celles du
  format, évaluées avec l’état, les drapeaux `page.hasPrev` / `page.hasNext`
  et ceux du serveur (`viewer.op`, `viewer.bedrock`).
- **Clic** (index reçu) : le slot mémorisé pour cette case lors de la
  composition ; ses actions s’exécutent dans l’ordre : `open` (empile),
  `back` (dépile, ou ferme), `close`, `setState`, `nextPage` / `prevPage`,
  `sound` (paquet `PlaySound` au joueur), `command` (`player` ou `console`,
  variables interpolées), `custom` (transmis à l’adaptateur du serveur).
- **Après le clic** : le client a déjà fermé le formulaire. Sauf `close` (ou
  `back` sur une pile vide), le serveur **renvoie** le menu en haut de la pile,
  recomposé : c’est l’équivalent du menu Java qui reste ouvert. Un menu qui
  doit se fermer après une commande le dit par une action `close`.
- **Fermeture** par le joueur (`UserClosed`) : la session est oubliée.
- **Variables** : `{viewer.name}`, `{viewer.uuid}`, `{state.<nom>}`,
  `{<page>.number}`, `{<page>.count}`, puis celles de l’adaptateur du serveur
  (mc-rs : `{mcrs.spawn}`, position de réapparition `x y z`).

## 7. Ce qui ne passe pas (et ce qui est approché)

L’exporteur liste ces cas dans `warnings` (et dans le message d’export) :

| Cas | Traitement |
|---|---|
| Slot `input` | impossible dans un formulaire (pas d’items) : ignoré ; il faudra le rendu « coffre surchargé » (étape E6) |
| Tête de joueur (`head`) | pas de rendu de tête dans une image de formulaire : pas d’icône |
| Item `material` | icône approchée par une table (`textures/items/…`, `textures/blocks/…`) ; un matériau inconnu donne `textures/items/<nom>` |
| Item `ref` | fourni par l’adaptateur du serveur : pas d’icône à l’export |
| Couleur hexadécimale d’un nom d’item (MiniMessage) | ramenée au code `§` le plus proche ; les couleurs des **textes** du menu restent exactes (figées dans le pack) |
| Son | nom Java traduit par une table (`ui.button.click` → `random.click`…) ; un son inconnu est gardé tel quel, avec un avertissement |
| `lore` | pas encore affiché (pas d’infobulle au survol) |
| Bouton hors des cases | impossible par construction : un slot est toujours sur des cases ; une couche qui « ressemble » à un bouton hors grille n’est pas cliquable |
| Largeur des textes | police Bedrock : l’alignement à droite ou centré suit le texte réel, à 1 px près de Java [à vérifier en jeu] |
| Liste (`list`) | cases remplies par une source de données du serveur ; sans source, cases vides |

Autres limites connues : un seul formulaire en attente par joueur ; chaque
changement d’état referme puis rouvre le formulaire (scintillement possible) ;
un nouveau visuel exige une reconnexion.

## 8. Premier consommateur : `/menu` de mc-rs

Les écrans de `/menu` (hub et panneaux de démonstration du pack `mcrs_ui`)
sont portés tels quels comme **formulaires Bedrock** (§ 9) dans l’espace de
travail `menu_forge/workspace/` du dépôt mc-rs, exportés dans
`menu_forge/export/`.
Inventaire de l’existant (formulaires écrits à la main dans
`connection/forms.rs`) et de ce qui est repris :

| Écran (`/menu <panneau>`) | Disposition `mcrs_ui` | Boutons (index) → action actuelle |
|---|---|---|
| `hub` (`/menu`) | `grid` | 0 Téléporter au spawn → `tp <spawn>` ; 1 Mode Créatif → `gamemode creative` ; 2 Mode Survie → `gamemode survival` ; 3 Régler sur Jour → `time set day` ; 4 Régler sur Nuit → `time set night` ; 5 Infos biome → `biome` ; 6 UI Showcase → ouvre `showcase` ; les commandes ferment le formulaire |
| `showcase` | `grid` | 0 à 7 → ouvre `grid`, `left_button`, `bottom_button`, `image_grid`, `square_image`, `motd`, `store`, `wrapped` ; 8 Retour → ouvre `hub` |
| `grid` | `grid` | Action A à F, Retour : tous → ouvre `showcase` |
| `left_button` | `left_button` | Partie classée, Partie rapide, Tutoriel, Paramètres, Retour : tous → ouvre `showcase` |
| `bottom_button` | `bottom_button` | 0 bannière « Mode Bedwars » (non cliquable) ; 1 à 3 Rejoindre solo, duo, squad → rien (formulaire fermé) ; 4 Retour → ouvre `showcase` |
| `image_grid` | `image_grid` | Forêt, Désert, Montagne, Marais, Retour : tous → ouvre `showcase` |
| `square_image` | `square_image` | l’image → ouvre `showcase` |
| `motd` | `motd` | bannière, Continuer, Quitter : tous → ouvre `showcase` |
| `store` | `store` | onglets Populaire, Nouveautés, Promotions ; Épée légendaire (1500), Pioche en diamant (800), Skin pirate (2000), Cape dragon (3500) : tous → ouvre `showcase` |
| `wrapped` | `wrapped` | trois images, Continuer, Fermer : tous → ouvre `showcase` |
| Échap | tous | ferme, rien d’autre |

Correspondance dans l’espace de travail :

- chaque écran est un formulaire Bedrock du même identifiant, dans la même
  disposition, avec exactement le titre, le contenu, les textes, les images et
  l’ordre des boutons de `forms.rs` (parité vérifiée par
  `menu_forge::export_tests` sur l’export versionné) ; seule nouveauté, une
  icône vanilla sur quatre boutons du hub (Téléporter au spawn, Mode Créatif,
  Régler sur Jour, UI Showcase) ;
- une commande qui fermait le formulaire devient `command` (en `player`) suivi
  de `close` ;
- « ouvre X » devient `open` vers X (le « Retour » actuel ouvre un écran
  précis, il ne dépile pas) ; « rien, formulaire fermé » (bannière et
  « Rejoindre » du panneau `bottom_button`) devient `close` ;
- la téléportation utilise la variable `{mcrs.spawn}`, calculée au clic comme
  aujourd’hui.

Les versions dessinées en grille de coffre (étape E2) restent dans l’espace
sous le préfixe `grid_` (`grid_hub`, `grid_showcase`, `grid_store`…) :
exportées, ouvrables par `/mf open grid_hub`, elles s’ouvrent entre elles.

## 9. Formulaires Bedrock

Un menu du format peut être un **formulaire Bedrock** (clé `form`,
[`format.md`](format.md) § Formulaire Bedrock) : le formulaire à boutons du
client, affiché dans l’une des huit dispositions du pack `mcrs_ui` du serveur.
Rien n’est généré pour lui dans le pack (ni `ui/menu_forge/<id>.json`, ni
entrée du routeur) ; seules ses icônes tirées de l’espace de travail y sont
copiées. Les deux packs sont donc nécessaires : Menu Forge pour les menus
coffre et les icônes, `mcrs_ui` pour les dispositions des formulaires.

### 9.1 Descripteur

`runtime.json` porte les formulaires dans une liste à part, `forms` (absente :
aucun formulaire ; un serveur qui ne la connaît pas l’ignore) :

```json
"forms": [
  {
    "id": "hub",
    "name": "Hub mc-rs",
    "layout": "grid",
    "flag": "§m§a",
    "title": "§l§6mc-rs§r §eHUB",
    "content": "§7Choisis une action :",
    "state": {},
    "buttons": [
      {
        "id": "spawn",
        "text": "§a▶ Téléporter au spawn",
        "image": { "type": "path", "data": "textures/items/compass_item" },
        "onClick": [{ "type": "command", "command": "tp {mcrs.spawn}", "as": "player" }, { "type": "close" }]
      },
      { "id": "banner", "text": "§m§a Mode Bedwars", "onClick": [{ "type": "close" }] },
      { "id": "admin", "text": "Admin", "visibleWhen": { "flag": "viewer.op" }, "onClick": [{ "type": "open", "menu": "admin" }] }
    ]
  }
]
```

| Clé | Rôle |
|---|---|
| `layout`, `flag` | disposition et son drapeau (tableau ci-dessous) ; le serveur refuse un couple qui ne correspond pas |
| `title` | titre sans drapeau : titre envoyé = `flag` + une espace + titre interpolé |
| `content` | texte de contenu, interpolé |
| `state` | variables d’état, comme pour un menu coffre |
| `buttons[].text` | texte **envoyé** : préfixe du rôle (`§m§a ` bannière, `§m§b ` bouton spécial), texte, puis tabulation et sous-titre ; variables interpolées par le serveur |
| `buttons[].image` | image telle qu’envoyée au client : `{"type": "path", "data": …}` (texture vanilla, d’un pack du serveur, ou icône copiée dans `textures/menu_forge/icons/`) ou `{"type": "url", "data": …}` ; absente, aucune |
| `buttons[].onClick`, `visibleWhen` | tels que dans le format (noms des sons traduits pour Bedrock) |

Menus et formulaires partagent les mêmes identifiants : `open` vise l’un ou
l’autre, et la pile `open` / `back` les mêle.

Dispositions et drapeaux, constantes du contrat (`model/bedrockForm.ts` du
studio, `menu_forge/catalog.rs` de mc-rs, `_global_variables.json` et
`server_form.json` du pack `mcrs_ui`) :

| `layout` | `grid` | `left_button` | `bottom_button` | `image_grid` | `square_image` | `motd` | `store` | `wrapped` |
|---|---|---|---|---|---|---|---|---|
| `flag` | `§m§a` | `§m§b` | `§m§c` | `§m§d` | `§m§e` | `§m§f` | `§m§0` | `§m§1` |

### 9.2 Exécution côté serveur

- **Composer** : titre, contenu, puis un bouton par entrée de `buttons` dont
  `visibleWhen` est vraie, dans l’ordre (texte interpolé, image telle quelle) ;
  le serveur retient quelle entrée chaque bouton envoyé représente.
- **Clic** : l’index reçu est le **rang parmi les boutons envoyés** ; avec un
  bouton masqué avant lui, la troisième entrée de `buttons` arrive avec
  l’index 1. Les actions de l’entrée retenue s’exécutent comme pour un slot
  (§ 6), puis le formulaire du haut de la pile est renvoyé, sauf fermeture.
- **Échap** : la session est oubliée.

### 9.3 Export

- aucune disposition générée, pas d’entrée dans `router.json` ni dans
  `_ui_defs.json` ;
- une icône `{ "texture": "a/b.png" }` de l’espace est copiée telle quelle
  (sans recadrage) en `pack/textures/menu_forge/icons/a/b.png` et citée comme
  `textures/menu_forge/icons/a/b` ;
- avertissements : rôle sans effet dans la disposition (bannière d’une grille,
  bouton spécial hors `left_button` et `bottom_button`), identifiants de
  boutons en double.

## 10. Voir aussi

- [`format.md`](format.md) : le format des menus (inchangé) ;
- [`rendering.md`](rendering.md) : le repère de coordonnées, commun aux deux
  plateformes ;
- `studio/src/export/bedrock/` : l’exporteur ; `studio/tests/bedrock.test.ts` :
  ses tests.

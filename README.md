<p align="center">
  <img src="site/assets/logo.svg" alt="" width="96" height="96">
</p>

<h1 align="center">menu-forge</h1>

<p align="center"><strong>Français</strong> · <a href="README.en.md">English</a></p>

<p align="center">
  <strong>Dessinez des inventaires Minecraft custom au pixel près, ouvrez-les en jeu sans calculer un seul décalage.</strong><br>
  Un studio local (appli de bureau ou navigateur) et une lib Paper, reliés par un format JSON ouvert.
</p>

<p align="center">
  <a href="https://pedrokarim.github.io/menu-forge/">Site du projet</a> ·
  <a href="docs/rendering.md">Modèle de rendu</a> ·
  <a href="docs/format.md">Format</a> ·
  <a href="docs/roadmap.md">Feuille de route</a>
</p>

![L’éditeur de menus de menu-forge : une boutique à onglets, un slot sélectionné et son inspecteur](site/assets/screens/menu-editor.png)

> **État : jeune projet, en développement actif.** Le modèle de rendu est validé
> en jeu (Paper 1.20.6), le studio et la lib fonctionnent de bout en bout, mais
> il n’y a pas encore de version publiée : on construit depuis les sources.

menu-forge est né pour **Enderium**, un serveur Minecraft : son plugin
(`enderium-core`) est le premier consommateur de la lib, branchée sur ses
actions, ses conditions et son pipeline de resource pack par un adaptateur.
La lib, elle, ne dépend d’aucun type d’Enderium et sert n’importe quel serveur
Paper.

## Pourquoi

Les menus « modernes » des serveurs Minecraft (onglets, modales, boutons
colorés, barres de progression…) ne sont pas des mods. Ce sont des **coffres
vanilla** dont le cadre est masqué et dont le **titre** contient des images,
dessinées par une police custom du resource pack. Le résultat est superbe, mais
le fabriquer à la main est pénible : chaque couche est un glyphe, chaque glyphe
a son `ascent` et son avance, et un pixel de travers décale tout ce qui suit.

menu-forge automatise toute la chaîne :

1. **Studio** (`studio/`) : on dessine le menu sur une toile calée sur la grille
   des slots, à partir de gabarits ; on place les couches, les textes
   dynamiques, les zones cliquables et leurs actions.
2. **Format** (`docs/format.md`) : le studio exporte un fichier `*.menu.json` et
   ses PNG, lisibles et versionnables.
3. **Lib** (`lib/`) : côté serveur Paper, elle lit ces fichiers, génère les
   polices du resource pack et ouvre les menus (titre composé selon l’état,
   slots, actions, pagination).

## Fonctionnalités

**Studio**

- Toile au pixel près, fond « cases seules » ou coffre vanilla, zoom et
  aimantation sur la grille des slots.
- Couches **générées** (panneau biseauté, bouton, cellule, voile, aplat) ou
  importées en PNG, déplaçables à la souris et au clavier, réordonnables,
  rognables (sprites d’atlas).
- Textes dynamiques avec variables (`{viewer.name}`, `{page.number}`…) et
  alignement à gauche, au centre ou à droite, mesurés avec les avances du jeu.
- Zones de slots dessinées sur la grille : bouton, liste paginée, dépôt,
  décoration ; actions au clic (ouvrir, retour, état, page, son, commande,
  action custom).
- Variables d’état, conditions d’affichage et d’activation, aperçu de chaque
  état.
- **Titre composé en direct**, jeton par jeton, avec le même algorithme que la
  lib : ce que vous voyez est ce que le joueur verra.
- Gabarits (coffre classique, modale, liste paginée, barre d’onglets) et
  héritage (`extends`).
- **Mode libre** : un éditeur d’assets (encarts, bulles de touche, badges…)
  exportés en PNG et en glyphe, prêts à glisser dans un texte.
- Bibliothèques de packs branchées en local (lecture seule, jamais publiées),
  annuler / rétablir, raccourcis clavier partout, aide-mémoire `?`.
- Style « Deepslate » : ardoise, biseaux de 2 px, or pour la sélection,
  infobulles violettes façon objet du jeu.

**Lib Java** (`lib/`)

- `menu-forge-core` (Java 17, Gson seulement) : parseur avec le chemin de la
  clé fautive, gabarits, conditions, mesure des PNG, composition du titre,
  génération du pack (une police par menu).
- `menu-forge-paper` : plugin Paper autonome **MenuForge**, avec une API et des
  points d’extension (`ListProvider`, `FlagProvider`, `PlaceholderResolver`,
  `ItemFactory`, `CustomActionHandler`), une session par joueur avec pile pour
  `back`, et les commandes `/menuforge open`, `reload`, `calibrate`.

## Captures

| | |
|---|---|
| ![Accueil : actions rapides et documents récents](site/assets/screens/home.png) | ![Une modale de confirmation dans l’éditeur](site/assets/screens/modal-editor.png) |
| **Accueil** : actions rapides, documents récents avec vignettes. | **Modales** : voile, panneau centré, boutons câblés sur des actions. |
| ![Éditeur d’assets : un encart d’aide](site/assets/screens/asset-editor.png) | ![Aide-mémoire des raccourcis clavier](site/assets/screens/shortcuts.png) |
| **Mode libre** : composer un asset et l’exporter en glyphe. | **Raccourcis** : tout se fait aussi au clavier. |

Toutes les captures sont produites par un script, sur un espace de
démonstration fait **uniquement** de textures générées par le studio : voir
[`site/README.md`](site/README.md).

## Comment ça marche

![La toile de la boutique et son titre composé, jeton par jeton](site/assets/screens/title-composition.png)

Un menu menu-forge est un coffre `generic_9xN` ordinaire. Deux astuces de
resource pack font le reste :

1. la texture du coffre est remplacée par une image « cases seules » : le cadre
   disparaît, les cellules des slots restent ;
2. tout le visuel est écrit dans le **titre** du coffre, avec une police dont
   chaque caractère est une image (provider `bitmap`).

Pour chaque couche visible, la lib écrit un **espace négatif ou positif** qui
amène le curseur à la bonne abscisse, puis le **glyphe** de la couche, dont
l’`ascent` fixe la hauteur (`ascent = 13 − y`). Le piège : Minecraft fait
avancer le curseur de la dernière colonne opaque de l’image + 2, pas de sa
largeur. menu-forge recadre chaque couche et **mesure son avance sur les
pixels**, dans le studio comme dans la lib.

Les slots restent de vrais slots : un bouton, c’est une image dans le titre
plus un slot (souvent avec un item invisible) posé au même endroit. Le titre
est dessiné sous les items, donc une couche peut peindre le fond d’un bouton
sans masquer son icône.

Tous les détails, mesurés et validés en jeu : [`docs/rendering.md`](docs/rendering.md).

## Installation

Prérequis : **Node 24**, **Rust stable** (1.95 ou plus), et sous Windows
**WebView2** (présent sur Windows 11). Pour la lib : **JDK 21**.

```sh
git clone https://github.com/pedrokarim/menu-forge.git
cd menu-forge/studio
npm install
```

### Le studio en appli de bureau (Tauri)

```sh
npm run tauri:dev     # fenêtre de développement
npm run tauri:build   # installateur Windows (NSIS)
```

L’installateur est écrit dans
`studio/src-tauri/target/release/bundle/nsis/`. Au premier lancement, le studio
propose un espace de travail (`Documents/menu-forge`, créé s’il manque).

### Le studio dans le navigateur

```sh
npm run dev
```

Lance le backend Rust (`studio-api`, sur `127.0.0.1:5174`) et Vite sur
<http://localhost:5173>. Le serveur n’écoute qu’en local et refuse toute
requête d’une autre origine. Options, réglages et API : [`studio/README.md`](studio/README.md).

### La lib Paper (plugin MenuForge)

```sh
cd lib
./gradlew build
```

Le plugin vise **Paper 1.20.6 et plus** (Java 21, `api-version` 1.20). Sur
1.21.4 et plus, il sait aussi donner un modèle d’item (`item_model`) aux
boutons invisibles ; avant, il utilise `CustomModelData`.

1. Déposer `menu-forge-paper/build/libs/MenuForge-<version>.jar` dans
   `plugins/`.
2. Copier les menus exportés par le studio dans
   `plugins/MenuForge/workspace/menus/` et leurs images dans
   `plugins/MenuForge/workspace/textures/`.
3. Au démarrage (et à chaque `/menuforge reload`), le plugin génère le pack de
   polices dans `plugins/MenuForge/pack/` : **intégrez-le au resource pack de
   votre serveur**.

Le visuel « cases seules » du coffre n’est pas fourni : c’est au pack du
serveur de le porter. API, points d’extension et configuration :
[`lib/README.md`](lib/README.md).

## Structure du dépôt

| Dossier | Rôle |
|---|---|
| [`docs/`](docs/) | Spécification du format, modèle de rendu, écrans, feuille de route (source de vérité) |
| [`studio/`](studio/) | Studio : interface Vite + React + TypeScript (`src/`), backend Rust (`backend/`), coquille Tauri 2 (`src-tauri/`) |
| [`lib/`](lib/) | Lib Java : noyau autonome `menu-forge-core` et plugin `menu-forge-paper` |
| [`templates/`](templates/) | Gabarits fournis (coffre, modale, onglets, liste paginée) |
| [`examples/`](examples/) | Espace de travail d’exemple du mode navigateur (contenu non versionné) |
| [`site/`](site/) | Site du projet (GitHub Pages) et script des captures |

## Documentation

- [`docs/rendering.md`](docs/rendering.md) : comment une couche devient un glyphe,
  coordonnées, `ascent`, avance, pièges connus.
- [`docs/format.md`](docs/format.md) : le format `*.menu.json` (couches, textes,
  slots, état, conditions, actions, gabarits).
- [`docs/assets.md`](docs/assets.md) : le format `*.asset.json` du mode libre.
- [`docs/screens.md`](docs/screens.md) : les écrans de l’application.
- [`docs/discord.md`](docs/discord.md) : la Rich Presence Discord (facultative).
- [`studio/README.md`](studio/README.md) : lancer, construire, API locale.
- [`lib/README.md`](lib/README.md) : la lib, le plugin et ses points d’extension.

## Feuille de route

Détail vivant dans [`docs/roadmap.md`](docs/roadmap.md). Prochaines étapes :

- premier vrai menu en production, recréé avec des textures générées ;
- éditeur visuel des états et des actions, sans passer par le JSON ;
- export d’un pack ZIP pour tester sans serveur ;
- copier / coller, multi-sélection, repères ;
- décider du sort de la texture globale du coffre (`generic_54.png`).

## Contribuer

Les contributions sont bienvenues : ouvrez d’abord une issue pour discuter d’un
changement important. Quelques règles du dépôt (détail dans
[`AGENTS.md`](AGENTS.md)) :

- **identifiants en anglais**, sans exception (variables, fonctions, types,
  fichiers, clés JSON du format) ; commentaires, textes d’interface, docs et
  messages de commit **en français** ;
- typographie française dans la prose : tiret demi-cadratin (–) pour une
  incise, guillemets « … », espaces insécables avant `: ; ! ?` ;
- **aucun asset tiers** dans le dépôt : les gabarits et textures fournis sont
  générés ou dessinés par le projet ;
- avant une pull request : `npm run build` et `npm run lint` dans `studio/`,
  `cargo test` dans `studio/backend/`, `./gradlew build` dans `lib/`.

## Licence

menu-forge est distribué sous licence **MIT**, © 2026 Karim (pedrokarim) : voir [`LICENSE`](LICENSE).
Les composants tiers gardent leur propre licence (ci-dessous).

## Crédits

| Composant | Usage | Licence |
|---|---|---|
| [Pixelarticons](https://github.com/halfmage/pixelarticons) | Icônes | MIT |
| [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) | Titres | SIL Open Font License 1.1 |
| [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) | Texte | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | Code et chemins | SIL Open Font License 1.1 |
| [React](https://react.dev/) | Interface | MIT |
| [Tauri](https://tauri.app/) | Application de bureau | MIT ou Apache 2.0 |
| [Gson](https://github.com/google/gson) | Lecture du format (lib) | Apache 2.0 |

Le studio embarque les polices des paquets `@fontsource` (et Pixelify Sans
dans `studio/public/fonts/` pour l’écran de démarrage) ; le site les
auto-héberge dans `site/assets/fonts/`, chacune avec sa licence.

## Mentions

menu-forge n’est ni affilié à Mojang ni approuvé par Mojang ; Minecraft est une
marque de Mojang AB. Le dépôt ne contient aucun asset de Minecraft : la police
du jeu et les packs tiers ne sont lus que depuis le poste de l’utilisateur, et
restent la propriété de leurs auteurs.

# Site de Menu Forge

Le site du projet, publié sur GitHub Pages par le workflow
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) : une page
statique, sans framework ni étape de construction, au style « Deepslate » du
studio.

| Chemin | Rôle |
|---|---|
| `index.html` | La page en français (accueil, fonctionnalités, galerie, fonctionnement, démarrage, documentation, mentions) |
| `en/index.html` | La même page en anglais, liée à la version française (sélecteur de langue, `hreflang`) |
| `assets/site.css` | Styles : mêmes jetons que `studio/src/index.css` |
| `assets/site.js` | Visionneuse des captures, boutons « Copier », section courante |
| `assets/fonts/` | Polices auto-hébergées (Pixelify Sans, Atkinson Hyperlegible, JetBrains Mono) et leurs licences SIL OFL 1.1 |
| `assets/screens/` | Captures du studio, produites par `scripts/capture.mjs` |
| `scripts/` | Outils de maintenance, non publiés |

Seuls `index.html` et `assets/` sont publiés.

## Prévisualiser

```sh
cd site
node scripts/serve.mjs      # http://localhost:5223/
```

## Refaire les captures

Les captures sont **reproductibles** : `scripts/capture.mjs` monte un espace de
travail de démonstration (`scripts/demo-workspace.mjs`) fait uniquement de
textures générées ou dessinées par le code du studio (générateur, rendu des
assets, encodeur de l’éditeur de pixels) et du logo du projet, avec des réglages sans
aucune bibliothèque (`"libraries": []`). Aucun asset tiers ne peut donc
apparaître à l’écran, et les textes du jeu sont dessinés avec la police pixel
de Menu Forge (voir [`../docs/rendering.md`](../docs/rendering.md)). Il lance le backend (`studio-api --no-discord`) et Vite
sur des ports dédiés (5221 et 5222), pilote l’interface avec Playwright, masque
les chemins de la machine, puis écrit les PNG dans `assets/screens/`.

L’espace de démonstration contient une boutique à onglets, une modale de
confirmation, un profil qui inclut un composant (« Barre de retour »), trois
assets et une image de l’éditeur de pixels (« Onglet boutique », en calques).
Son dossier « Export vers le plugin » est un sous-dossier du dossier de
travail, affiché comme les ressources d’enderium-core : la capture `export` y
écrit vraiment, et tout est effacé au lancement suivant.

| Capture | Ce qu’elle montre |
|---|---|
| `home` | Accueil : actions rapides, documents récents (menus, assets, image) |
| `menu-editor` | Éditeur de menus : la boutique, le slot « buy » sélectionné (capture du haut de page) |
| `pixel-editor` | Éditeur de pixels : l’onglet de boutique en trois calques, symétrie et crayon en cours |
| `multi-select` | Quatre couches sélectionnées, barre « Aligner et répartir » de l’inspecteur |
| `visual-editors` | Slot « buy » : actions au clic, « Visible si », « Actif si » en arbre (fenêtre de 1180 px de haut) |
| `try-mode` | Mode « Essayer » : clics simulés, pile de deux menus, journal |
| `components` | Profil : éléments d’instance marqués « composant », « Composants inclus » |
| `export` | Export vers le plugin fait, menu contextuel des exports (fenêtre de 1920 px de large) |
| `modal-editor` | Modale de confirmation, bouton « Oui » sélectionné |
| `menu-canvas` | Gros plan : la boutique telle qu’en jeu, zones masquées |
| `title-composition` | Gros plan : la toile et les jetons du titre composé |
| `texture-generator` | Générateur de textures, cellules de slots cochées |
| `asset-editor` | Éditeur d’assets : l’encart d’aide et son export |
| `shortcuts` | Aide-mémoire des raccourcis |
| `settings` | Paramètres (export vers le plugin compris) |

Prérequis : les dépendances du studio installées (`npm install` dans
`studio/`), Rust (le backend est compilé s’il manque) et, pour réduire le poids
des PNG, Python avec Pillow (sinon les PNG restent bruts).

```sh
cd site
npm install            # installe Playwright
npx playwright install chromium
npm run capture
```

Options (variables d’environnement) :

| Variable | Rôle |
|---|---|
| `MF_ONLY` | Captures à refaire, par exemple `MF_ONLY=home,menu-editor` |
| `MF_UI_PORT`, `MF_API_PORT` | Autres ports que 5221 et 5222 |
| `MF_CAPTURE_DIR` | Dossier de travail (vidé à chaque lancement) |
| `MF_BROWSER_CHANNEL` | Navigateur installé à utiliser (`msedge`, `chrome`) au lieu du Chromium de Playwright |
| `PLAYWRIGHT_DIR` | Dossier `node_modules` d’un Playwright déjà installé ailleurs |
| `MF_KEEP_RAW` | Ne pas optimiser les PNG |

Pour ajouter une capture : déclarer un `shot(...)` dans `capture.mjs`, puis
mettre à jour la galerie de `index.html` et relancer `python scripts/build.py`
(dimensions des images et icônes).

## Icônes et dimensions

`index.html` contient un sprite SVG des icônes utilisées (pixelarticons, MIT,
et quelques dessins maison sur la même grille). `scripts/build.py` le
régénère depuis `studio/node_modules/pixelarticons` et reporte la taille réelle
de chaque capture dans les attributs `width` / `height` des images.

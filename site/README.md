# Site de menu-forge

Le site du projet, publié sur GitHub Pages par le workflow
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) : une page
statique, sans framework ni étape de construction, au style « Deepslate » du
studio.

| Chemin | Rôle |
|---|---|
| `index.html` | La page (accueil, fonctionnalités, galerie, fonctionnement, démarrage, documentation, mentions) |
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
textures générées par le studio et du logo du projet, avec des réglages sans
aucune bibliothèque (`"libraries": []`). Aucun asset tiers ne peut donc
apparaître à l’écran. Il lance le backend (`studio-api --no-discord`) et Vite
sur des ports dédiés (5221 et 5222), pilote l’interface avec Playwright, masque
les chemins de la machine, puis écrit les PNG dans `assets/screens/`.

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

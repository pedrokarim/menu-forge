# Site de Menu Forge

Le site du projet, publié sur GitHub Pages par le workflow
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) : des pages
statiques, sans framework, au style « Deepslate » du studio. L’accueil existe
en français et en anglais ; la documentation est générée depuis `docs/`.

| Chemin | Rôle |
|---|---|
| `index.html` | Accueil en français : fonctionnalités, générateur, IA, Java et Bedrock, galerie, fonctionnement, démarrage, documentation, mentions |
| `en/index.html` | Le même accueil en anglais, lié à la version française (sélecteur de langue, `hreflang`) |
| `docs/` | **Généré, non versionné** : une page HTML par document (`docs/*.md`, `lib/README.md`, `studio/README.md`) et les schémas JSON |
| `en/docs/` | **Généré, non versionné** : la documentation anglaise, une page par traduction (`docs/README.en.md` devient `index.html`, `docs/guide.en.md` devient `guide.html`) |
| `assets/site.css` | Styles : mêmes jetons que `studio/src/index.css` |
| `assets/site.js` | Visionneuse des captures, boutons « Copier », section courante, menu des pages de documentation |
| `assets/fonts/` | Polices auto-hébergées (Pixelify Sans, Atkinson Hyperlegible, JetBrains Mono) et leurs licences SIL OFL 1.1 |
| `assets/screens/` | Captures du studio, produites par `scripts/capture.mjs` |
| `scripts/` | Outils de maintenance, non publiés |

Sont publiés : `index.html`, `en/`, `docs/` et `assets/`.

## Construire

```sh
python site/scripts/build.py          # tout : sprite des icônes, captures, documentation, liens
python site/scripts/build.py --docs   # documentation et liens seulement, sans dépendance
```

`scripts/build.py`, depuis la racine du dépôt :

- **Icônes** (mode complet) : régénère le sprite SVG des deux accueils à
  partir des icônes réellement employées (`#i-<nom>`), lues dans
  `studio/node_modules/pixelarticons` (MIT) ou dessinées sur la même grille ;
  les pages de documentation reprennent les leurs dans le sprite de l’accueil.
- **Captures** : reporte la taille réelle de chaque PNG dans les attributs
  `width` et `height` des images, pour qu’aucune page ne bouge au chargement.
- **Documentation** : une page par document de la liste `DOC_PAGES`, avec le
  menu latéral de `DOC_GROUPS`, le sommaire de la page, les liens « page
  précédente » et « page suivante », la source et un lien « Proposer une
  modification ». Le convertisseur Markdown, sans dépendance, couvre ce
  qu’emploie la documentation : titres, paragraphes, listes imbriquées,
  tableaux, blocs de code, citations, liens, images, gras, italique et code.
  Les liens entre documents deviennent des liens entre pages, une capture
  `../site/assets/screens/*.png` seule dans son paragraphe devient une figure
  agrandissable, tout autre fichier du dépôt un lien vers GitHub. Les
  identifiants des titres sont calculés comme sur GitHub : une ancre
  (`guide.md#4-un-premier-formulaire-bedrock`) marche aux deux endroits.
- **Vérifications** : tout lien relatif et toute ancre des accueils et des
  pages de documentation doivent mener quelque part ; une erreur arrête le
  script, et donc la publication.

Le workflow Pages lance `python site/scripts/build.py --docs` avant chaque
publication (push sur `main` qui touche `site/`, `docs/`, `lib/README.md` ou
`studio/README.md`) : la documentation publiée suit toujours le dépôt, et les
pages générées n’ont pas à être versionnées.

**Ajouter une page de documentation** : écrire `docs/<nom>.md`, qui commence
par un titre `#` ; l’ajouter à `DOC_PAGES` (avec son libellé anglais) et à un
groupe de `DOC_GROUPS` dans `build.py`, puis au sommaire `docs/README.md` et à
son pendant anglais `docs/README.en.md`.

### Documentation anglaise

Une page traduite s’écrit à côté de l’originale, sous le même nom suivi de
`.en` (`docs/guide.en.md` pour `docs/guide.md`), et se déclare dans
`TRANSLATIONS` de `build.py`. Elle est publiée sous `en/docs/<page>.html`,
avec la navigation anglaise :

| Adresse | Source |
|---|---|
| `en/docs/` | `docs/README.en.md`, l’index anglais |
| `en/docs/guide.html` | `docs/guide.en.md` |

- **Menu latéral anglais** : les mêmes groupes que le menu français, sous leurs
  libellés anglais (`EN_LABELS`, `EN_GROUPS`). Une page traduite mène à sa
  version anglaise ; une page qui ne l’est pas mène à la page française,
  marquée « (in French) » et `hreflang="fr"`.
- **Sélecteur de langue** : sur une page traduite, FR et EN relient les deux
  versions de la même page (et `<link rel="alternate" hreflang>` les
  déclare) ; sur une page sans traduction, EN mène à l’index anglais.
- **Liens** : dans une page anglaise, un lien vers `guide.en.md` mène à la
  page anglaise, un lien vers `screens.md` à la page française. Les liens et
  les ancres des pages anglaises sont vérifiés comme les autres : un lien mort
  bloque la publication.
- **Page précédente, page suivante** : parcourent les seules pages traduites,
  dans l’ordre du menu.

## Prévisualiser

```sh
python site/scripts/build.py
cd site
node scripts/serve.mjs      # http://localhost:5223/
```

## Refaire les captures

Les captures sont **reproductibles** : `scripts/capture.mjs` monte un espace de
travail de démonstration (`scripts/demo-workspace.mjs`) fait uniquement de
textures générées ou dessinées par le code du studio (générateur, rendu des
assets, encodeur de l’éditeur de pixels) et du logo du projet, avec des
réglages sans aucune bibliothèque (`"libraries": []`). Aucun asset tiers ne
peut donc apparaître à l’écran, et les textes du jeu sont dessinés avec la
police pixel de Menu Forge (voir [`../docs/rendering.md`](../docs/rendering.md)).
Le script lance le backend (`studio-api --no-discord`) et Vite sur des ports
dédiés (5221 et 5222), pilote l’interface avec Playwright, masque les chemins
de la machine, puis écrit les PNG dans `assets/screens/`.

L’espace de démonstration contient une boutique à onglets, une modale de
confirmation, un profil qui inclut un composant (« Barre de retour »), trois
assets et une image de l’éditeur de pixels (« Onglet boutique », en calques).
Son dossier « Export vers le plugin » est un sous-dossier du dossier de
travail, affiché comme les ressources d’enderium-core : la capture `export` y
écrit vraiment, et tout est effacé au lancement suivant.

| Capture | Ce qu’elle montre |
|---|---|
| `home` | Accueil : actions rapides, « Voir les exemples », documents récents |
| `menu-editor` | Éditeur de menus : la boutique, le slot « buy » sélectionné |
| `modal-editor` | Modale de confirmation, bouton « Oui » sélectionné |
| `menu-canvas` | Gros plan : la boutique telle qu’en jeu, zones masquées |
| `title-composition` | Gros plan : la toile et les jetons du titre composé |
| `texture-generator` | Générateur de textures, cellules de slots cochées |
| `asset-editor` | Éditeur d’assets : l’encart d’aide et son export, colonne de droite élargie au clavier |
| `shortcuts` | Aide-mémoire des raccourcis |
| `multi-select` | Quatre couches sélectionnées, barre « Aligner et répartir » |
| `visual-editors` | Slot « buy » : actions au clic, « Visible si », « Actif si » en arbre (fenêtre de 1180 px de haut) |
| `try-mode` | Mode « Essayer » : clics simulés, pile de deux menus, journal |
| `components` | Profil : éléments d’instance marqués « composant », « Composants inclus » |
| `export` | Export vers le plugin fait, menu contextuel des trois exports (fenêtre de 1920 px de large) |
| `pixel-editor` | Éditeur de pixels : l’onglet de boutique en trois calques, symétrie et crayon en cours |
| `settings` | Paramètres (export vers le plugin compris) |
| `bedrock-form` | Éditeur de formulaires Bedrock : le hub de démonstration, bouton « Boutique » sélectionné |
| `bedrock-layouts` | « Nouveau menu » : les huit dispositions des formulaires Bedrock, la grille choisie |
| `interface-generator` | Générateur d’interfaces : barre d’onglets en style « sombre à accent » |
| `interface-examples` | Galerie d’exemples du générateur, l’exemple « Marché » sélectionné, vignettes dessinées |
| `generated-menu` | Une boutique créée par le générateur (style mc-rs), ouverte dans l’éditeur |
| `ai-settings` | Paramètres, section IA : les onze fournisseurs, aucun activé, fiche OpenAI dépliée sans clé |
| `ai-texture` | « Générer une texture par IA » : sortie du faux Automatic1111, texture ramenée sur 16 × 16 |
| `ai-interface` | « Générer une interface par IA » : réponse du faux Ollama refusée au premier essai, corrigée au second |
| `ai-jobs` | Génération d’interface en tâche de fond : indicateur du rail, notification de progression, essai refusé |
| `ai-job-dialog` | La même tâche rouverte pendant la correction : étapes, chronomètre, journal des essais |
| `panels` | Colonne de l’inspecteur élargie au clavier, infobulle de la poignée (dernière capture : la largeur reste mémorisée) |

Les captures `ai-*` ne contactent **aucun** service : `capture.mjs` lance un
faux Automatic1111 et un faux Ollama sur `127.0.0.1` (port libre), qui
renvoient l’émeraude et le menu décrits dans `DEMO_AI` (`demo-workspace.mjs`).
Pour `ai-jobs` et `ai-job-dialog`, un faux Ollama **lent**, celui des tests de
bout en bout (`studio/e2e/lib/fakeAi.mjs`), garde chaque réponse jusqu’à ce que
la capture la libère : le premier essai est refusé, le second reste en attente
pendant les deux captures. Le backend lit le vrai trousseau du système sans
jamais y écrire, et la capture est refusée si une clé d’API y est déjà rangée.

Le formulaire Bedrock de démonstration (`hub`, `DEMO_FORM` dans
`capture.mjs`) est écrit par l’API au moment de sa capture : il n’entre pas
dans `DEMO_MENUS`, dont dépendent les tests de bout en bout. Ses icônes sont
des textures de l’espace, cuites par le studio.

Prérequis : les dépendances du studio installées (`npm install` dans
`studio/`), Rust (le backend est compilé s’il manque) et, pour réduire le poids
des PNG, Python avec Pillow (sinon les PNG restent bruts).

```sh
cd site
npm install            # installe Playwright
npx playwright install chromium
npm run capture
python scripts/build.py
```

Options (variables d’environnement) :

| Variable | Rôle |
|---|---|
| `MF_ONLY` | Captures à refaire, par exemple `MF_ONLY=home,menu-editor` |
| `MF_UI_PORT`, `MF_API_PORT` | Autres ports que 5221 et 5222 |
| `MF_CAPTURE_DIR` | Dossier de travail (vidé à chaque lancement) |
| `MF_BROWSER_CHANNEL` | Navigateur installé à utiliser (`msedge`, `chrome`) au lieu du Chromium de Playwright |
| `PLAYWRIGHT_DIR` | Dossier `node_modules` d’un Playwright déjà installé ailleurs |
| `MF_KEEP_RAW` | Ne pas optimiser les PNG |

Le cache des dépendances de Vite est gardé d’un lancement à l’autre dans
`studio/node_modules/.vite-capture` : sans lui, la première page dépasse les
délais.

Pour ajouter une capture : déclarer un `shot(...)` dans `capture.mjs`, puis
l’ajouter aux galeries de `index.html` et de `en/index.html` et relancer
`python scripts/build.py` (dimensions des images et icônes).

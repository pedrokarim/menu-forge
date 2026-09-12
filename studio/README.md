# Studio Menu Forge

Éditeur local des menus : interface React (`src/`), backend Rust
(`backend/`, crate `studio-backend`) et coquille de bureau Tauri 2
(`src-tauri/`, crate `menu-forge`). Le backend Rust a remplacé l’ancien
serveur TypeScript (plugin Vite), retiré après validation de la parité.

Prérequis : Node 24, Rust stable (1.95 ou plus) et, sous Windows, WebView2
(présent sur Windows 11).

```sh
npm install
```

## Mode navigateur

| Commande | Ce qui tourne |
|---|---|
| `npm run dev` | `studio-api` (backend Rust) sur `127.0.0.1:5174` **et** Vite sur `http://localhost:5173`, qui « proxifie » `/api` vers lui |
| `npm run dev:vite` | Vite seul (le proxy `/api` attend un backend sur 5174 : `npm run api`, ou l’appli Tauri) |
| `npm run api` | `studio-api` seul (options : `npm run api -- --help`) |

`vite.config.ts` « proxifie » toujours `/api` vers `http://127.0.0.1:5174`.

En mode navigateur, les réglages sont dans `studio/.cache/settings.json`. Au
premier lancement, l’espace de travail actif est `../examples` et les
bibliothèques sont importées de `../libraries.local.json`. Les options
`--workspace` et `--libraries` de `studio-api` (ou `MENU_FORGE_WORKSPACE`,
`MENU_FORGE_LIBRARIES`) imposent un espace ou des bibliothèques **pour la
session seulement**, sans toucher au fichier de réglages : c’est ce qu’il faut
pour les tests automatiques. `--settings <fichier>` choisit un autre fichier.

## Mode Tauri (appli de bureau)

```sh
npm run tauri:dev
```

Tauri lance Vite seul (`npm run dev:vite`), compile la
coquille et ouvre la fenêtre sur `http://localhost:5173`. Le backend tourne
**dans le processus de l’appli**, sur le port 5174 : arrêtez d’abord tout
`studio-api` ou `npm run dev` qui occuperait 5173 ou 5174.

Au démarrage, un écran d’accueil (`public/splash.html`) s’affiche au moins
1,8 s, puis laisse la place à la fenêtre principale dès que sa page a fini de
charger (20 s au plus).

## Construire l’installateur

```sh
npm run tauri:build
```

Produit `src-tauri/target/release/menu-forge.exe` et l’installateur NSIS
`src-tauri/target/release/bundle/nsis/Menu Forge_<version>_x64-setup.exe`.

En production, l’appli choisit un port libre, sert l’interface embarquée et
l’API depuis le même serveur (`http://127.0.0.1:<port>/`), et écrit le port
réel dans `%LOCALAPPDATA%\eu.enderium.menuforge\server.json`.

| Quoi | Où (Windows) |
|---|---|
| Réglages | `%APPDATA%\eu.enderium.menuforge\settings.json` |
| Caches (index des bibliothèques), `server.json` | `%LOCALAPPDATA%\eu.enderium.menuforge\` |
| Espace de travail du premier lancement | `Documents\menu-forge` (créé s’il manque) |
| Gabarits | embarqués avec l’appli (`templates/`) |

Au premier lancement, les bibliothèques sont importées du premier
`libraries.local.json` trouvé : variable `MENU_FORGE_LIBRARIES`, dossier des
réglages, puis celui du dépôt.

## API locale

Routes historiques (identiques à l’ancien serveur TypeScript) : `GET /api/workspace`,
`PUT /api/menus/:id`, `PUT /api/assets/:id`, `GET|PUT /api/textures/…`,
`GET /api/libraries`, `GET /api/libraries/:id/index`,
`GET /api/libraries/:id/raw/…`, `POST /api/libraries/:id/import`.

Routes de l’application :

| Route | Rôle |
|---|---|
| `GET /api/app` | `{ name, version, mode: "browser" \| "tauri", settingsPath, platform, overrides, firstLaunch }` ; `firstLaunch` : le fichier de réglages n’existait pas au démarrage du backend |
| `GET /api/settings` | réglages (voir ci-dessous) |
| `PUT /api/settings` | document partiel, validé strictement, appliqué aussitôt ; renvoie les réglages |
| `GET /api/workspaces` | `{ active, workspaces: [{ path, name, lastOpened, active, exists, menus, assets, textures }] }` |
| `POST /api/workspaces/open` | `{ path, name? }` : dossier absolu existant ; crée `menus/`, `assets/`, `textures/` s’ils manquent ; devient l’espace actif |
| `DELETE /api/workspaces` | `{ path }` : retire de la liste (409 pour l’espace actif), **ne supprime aucun fichier** |
| `GET /api/documents/recent` | `[{ type: "menu" \| "asset" \| "pixel", id, name, modified, texture? }]`, du plus récent au plus ancien ; `texture` : PNG exporté d’une image de pixels |
| `GET /api/pixels` | images de l’éditeur de pixels : `[{ id, name, width, height, layers, texture, modified }]` (sans les calques) |
| `GET /api/pixels/:id` | le document `pixels/<id>.pixel.json` complet (format dans [`../docs/pixels.md`](../docs/pixels.md)) |
| `PUT /api/pixels/:id` | enregistre le document après validation (taille, calques PNG, texture d’export sous `textures/`) ; écriture atomique |
| `POST /api/documents/rename` | `{ type, from, to, name? }` : change l’identifiant d’un menu ou d’un asset (fichier et champ `id`) ; 404 si `from` manque, 409 si `to` existe ; textures copiées sous le nouveau nom, jamais déplacées |
| `POST /api/documents/duplicate` | même corps : copie sous `to`, l’original reste |
| `POST /api/documents/trash` | `{ type, id }` : déplace le document dans `<espace>/.trash/<date>/`, **ne supprime jamais rien** ; renvoie `{ type, id, trashed }` |
| `POST /api/export/plugin` | écrit les menus résolus et leurs textures dans `<dossier « Export vers le plugin »>/menuforge/`, avec le manifeste ; voir l’en-tête de `backend/src/app.rs` |
| `PUT /api/exports/<nom>.zip` | écrit le pack ZIP de test dans `<espace>/exports/` |
| `GET /api/export/bedrock` | `{ directory, version }` : dossier d’export Bedrock et version du pack déjà exporté (`null` s’il n’y en a pas) ; 409 si le dossier n’est pas réglé |
| `POST /api/export/bedrock` | `{ files: [{ path, data }] }` (base64) : écrit `pack/…` et `runtime.json` dans le dossier d’export Bedrock ; 409 si la version du pack n’augmente pas ; voir l’en-tête de `backend/src/app.rs` |
| `POST /api/libraries` | `{ id, name, root, ownership }` : `root` absolu, contenant `assets/` |
| `DELETE /api/libraries/:id` | débranche le pack (rien n’est supprimé sur le disque) |
| `POST /api/libraries/:id/reindex` | reconstruit l’index sans cache ; renvoie `{ id, textures, fonts }` |
| `GET /api/ai/providers`, `PUT /api/ai/providers/:id`, `PUT\|DELETE /api/ai/keys/:id`, `POST /api/ai/test/:id`, `POST /api/ai/image`, `POST /api/ai/text`, `POST /api/ai/cancel`, `GET /api/ai/progress/:requestId` | génération par IA (fournisseurs, clés dans le trousseau du système, textures, interfaces, annulation, progression) : voir [`../docs/ai.md`](../docs/ai.md) ; `studio-api --ephemeral-secrets` garde les clés en mémoire (tests) |

Forme des réglages :

```json
{
  "version": 1,
  "activeWorkspace": "C:\\Users\\…\\Documents\\menu-forge",
  "workspaces": [{ "path": "C:\\…\\menu-forge", "name": "menu-forge", "lastOpened": "2026-09-10T08:00:00.000Z" }],
  "libraries": [{ "id": "vanilla", "name": "Minecraft 1.21.5", "root": "C:\\…\\vanilla-1.21.5", "ownership": "third-party" }],
  "ui": { "defaultZoom": 0, "showGrid": true, "confirmations": { "delete": true, "discardChanges": true } },
  "export": { "enderiumResources": null, "namespace": "menuforge", "packFormat": 46, "bedrockDirectory": null }
}
```

`ui.defaultZoom` va de 0 à 12 : 0 (par défaut) signifie « Ajuster », le plus
grand palier qui tient dans la toile.

`PUT /api/settings` fusionne `ui`, `ui.confirmations` et `export` clé par clé ;
`workspaces` et `libraries` sont remplacés en entier. Toute clé inconnue est
refusée (400, message en français). Les chemins nouveaux ou modifiés doivent
être absolus et exister ; renvoyer tel quel ce qu’on a lu ne change rien.

Le serveur n’écoute que sur 127.0.0.1 et refuse tout en-tête `Host` ou
`Origin` non local (protection contre le « DNS rebinding » et les requêtes
intersites).

## Export

Les trois exports (vers le plugin, pack ZIP de test, Bedrock), ce qu’ils écrivent
et où : [`../docs/export.md`](../docs/export.md). La génération est en TypeScript
(`src/export/`) ; le backend ne fait qu’écrire, par les routes ci-dessus.

## Tests de bout en bout

```sh
npm run e2e                     # toute la suite
npm run e2e -- pixels exports   # les scénarios ou tests dont le nom contient ces mots
```

`e2e/run.mjs` (Node, sans dépendance ajoutée au studio) :

1. compile `studio-api` en release (`cargo build --release`, rapide s’il est à jour) ;
2. crée un espace de travail temporaire (`<temp>/menu-forge-e2e-*`) : copie des
   gabarits de `../templates/`, menus, assets et image de démonstration de
   `../site/scripts/demo-workspace.mjs` (textures générées par le studio
   lui-même, aucun asset tiers), réglages avec `"libraries": []` ;
3. démarre l’API (`--no-discord`, réglages, bibliothèques, gabarits et caches
   dans l’espace temporaire) et un Vite de test (config générée dans `.cache/`) ;
4. joue les scénarios de `e2e/scenarios/` avec Playwright ;
5. arrête ce qu’il a lancé (par PID) et supprime ce qu’il a créé, même en cas
   d’échec ou d’interruption (Ctrl+C).

Le code de sortie est non nul si un test échoue ; la page au moment de l’échec
est capturée dans `e2e/results/` (ignoré par git). La suite compte 13 scénarios et 61 tests ;
une suite complète dure de deux à quatre minutes selon la machine.

Playwright n’est pas une dépendance du studio : il est cherché dans
`PLAYWRIGHT_DIR`, puis dans les dépendances du studio et du site. Le navigateur
est le Chromium de Playwright (sous Windows, `%LOCALAPPDATA%\ms-playwright`),
sinon Edge. Sur un poste qui n’a pas Playwright : `npm install playwright-core`
dans un dossier **hors du dépôt**, puis, par exemple sous PowerShell,
`$env:PLAYWRIGHT_DIR = "C:\chemin\vers\ce-dossier\node_modules"`.

| Variable | Rôle | Par défaut |
|---|---|---|
| `PLAYWRIGHT_DIR` | dossier `node_modules` qui contient `playwright` ou `playwright-core` | résolution normale |
| `MF_E2E_UI_PORT`, `MF_E2E_API_PORT` | ports de Vite et de l’API (un port occupé arrête la suite, rien n’est tué) | 5390 et 5391 |
| `MF_BROWSER_CHANNEL` | navigateur installé à utiliser (`msedge`, `chrome`…) | Chromium de Playwright, sinon Edge |
| `MF_STUDIO_API` | binaire `studio-api` déjà compilé | compilé par cargo |
| `MF_E2E_HEADED=1` | navigateur visible | sans fenêtre |
| `MF_E2E_KEEP=1` | garder l’espace temporaire pour l’inspecter | supprimé |
| `MF_VERBOSE=1` | journaux de l’API et de Vite | silencieux |

| Scénario | Ce qui est vérifié |
|---|---|
| `01-navigation` | rail d’écrans et adresse, Ctrl+1…5, Ctrl+O, « ? », aussi en AZERTY (lettres sur la touche produite, chiffres sur la touche physique) ; à la taille minimale (1024 × 600), audit des écrans, des éditeurs et des dialogues : rien ne dépasse de son conteneur visible, pas de défilement horizontal |
| `02-menu-editor` | nouveau menu depuis un gabarit ou vierge, zones de slots (tracer, glisser, poignée, Échap pendant un glisser, annuler / rétablir), aimantation et Alt, Ctrl+molette, défilement, clic répété (élément du dessous), menus contextuels, rognage d’atlas (grille, sprite, extraction) relu octet pour octet |
| `03-editing` | sélection multiple (liste, plage, toile, rectangle, Ctrl+A), copier / couper / coller / dupliquer, aligner / répartir, verrou et masquage, renommer / dupliquer / corbeille depuis l’accueil et l’éditeur, glisser-déposer d’un PNG |
| `04-asset-editor` | nouvel asset, boîte, texte, image, groupes, clavier, presse-papiers, PNG exporté relu (un élément masqué n’y est pas) |
| `05-pixel-editor` | crayon, ligne, rectangle plein, sélection et Suppr, pot de peinture, calques, gomme, pipette, annuler / rétablir, PNG exporté relu octet pour octet, fusion et duplication de calques |
| `06-visual-editors` | actions au clic (ajout, Alt+↑, suppression, menu visé), conditions, item et aperçu MiniMessage, variables d’état renommées avec leurs références, mode « Essayer », composants (instance, détacher, créer depuis une sélection) |
| `07-interface-generator` | les cinq types et les trois familles en aperçu, aperçu cliquable, un menu créé par type (textures cuites sur le disque) |
| `08-exports` | dossier d’export réglé par les Paramètres sur l’espace temporaire (jamais un vrai projet), « Exporter vers le plugin » (menus résolus, textures, manifeste), « Pack ZIP » (`pack.mcmeta`, polices, textures), Ctrl+E, Ctrl+Maj+E, fichiers d’un menu disparu retirés |
| `09-layout` | mise en page à huit tailles (1024 à 1600 px de large, 600 à 900 px de haut) : écrans (réglages d’export Bedrock compris), quatre éditeurs (menus, assets, pixels, formulaires Bedrock), dialogues, menu contextuel, infobulle, puis données extrêmes (noms de 80 caractères avec et sans espaces, 50 couches, 30 zones de slots, 40 documents, palette pleine, bibliothèques et espace aux noms longs, formulaires des huit dispositions à 30 boutons et longs chemins d’icône, dossier Bedrock profond) et états vides ; audit : débordements, textes coupés, chevauchements, dialogue recouvert, alignement des barres d’outils, onglets de même hauteur, titres cassés, cartes creuses, page qui défile en entier ; `MF_LAYOUT_SHOTS=<dossier>` garde une capture de chaque état |
| `10-panels` | colonnes redimensionnables des quatre éditeurs (formulaires Bedrock compris) : glisser la poignée, largeur retrouvée après rechargement, double-clic pour rétablir, clavier (flèches, Maj, Début, Fin, Entrée), audit aux largeurs minimale et maximale, zoom « Ajuster » recalculé |
| `11-zoom` | raccourcis de zoom des trois toiles et de l’aperçu des formulaires Bedrock : « + », « - », Maj+0, Maj+1, Maj+2 (avec ou sans sélection), outil Zoom (Z bref ou maintenu, clic, Alt+clic, rectangle), AZERTY, touche tapée dans un champ, Ctrl+molette de l’éditeur d’assets |
| `12-bedrock-forms` | formulaires Bedrock : création depuis « Nouveau menu », disposition, bouton avec icône, aperçu, inspecteur et colonnes sans débordement (huit dispositions, trois tailles, trois écrans simulés), réglages Bedrock, export vers un dossier temporaire (`runtime.json`, pack, icône copiée octet pour octet) |
| `13-ai-jobs` | générations par IA en tâches de fond, avec des fournisseurs simulés lents (`e2e/lib/fakeAi.mjs`, réponses libérées par le test) : phases lues au backend, chronomètre, dialogue fermé sans arrêter la tâche, indicateur du rail, notifications d’essai refusé et de succès, « Ouvrir », « Annuler », deux tâches à la fois, audit de mise en page à 1024 × 600, 1280 × 800 et 1600 × 900 |

Les vérifications portent sur des valeurs (inspecteur, fichiers écrits, JSON,
pixels des PNG), jamais sur des captures comparées pixel à pixel. Chaque test
échoue aussi sur toute erreur de page, de console ou réponse HTTP en erreur
(hors police vanilla introuvable, voulue sans bibliothèque).

## Police des aperçus

Sans pack vanilla branché, les textes du jeu sont dessinés avec la police pixel
de Menu Forge ([`../docs/rendering.md`](../docs/rendering.md#aperçu-dans-le-studio)).
Données : `src/lib/pixelFontGlyphs.ts` ; planche et rendu : `src/lib/pixelFont.ts` ;
choix de la police : `src/lib/previewFont.ts`.

## Tests

```sh
npm test                   # pack, schéma, parité avec la lib, textures générées, générateur d’interfaces
cd backend && cargo test   # backend Rust
```

`npm test` lance `tests/*.test.ts` et `tests/*.test.mjs` avec le lanceur de tests de Node, sans
dépendance : Node efface les types à la volée (`tests/resolve-ts.mjs` résout les imports sans
extension), valide [`../docs/menu.schema.json`](../docs/menu.schema.json) sur les gabarits et
exemples du dépôt, vérifie la génération du pack (PNG, zip) et joue les fixtures de parité
partagées avec la lib (`../lib/menu-forge-core/src/test/resources/parity`). Ils vérifient aussi les textures générées (formes au pixel près, couleurs
des états mc-rs, empreintes des PNG cuits) et le générateur d’interfaces
(toutes les combinaisons d’options valides contre le schéma, cohérentes et
jouables dans le mode « Essayer »).

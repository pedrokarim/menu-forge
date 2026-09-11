# Studio menu-forge

Éditeur local des menus : interface React (`src/`), backend Rust
(`backend/`, crate `studio-backend`) et coquille de bureau Tauri 2
(`src-tauri/`, crate `menu-forge`). Le backend Rust a remplacé l’ancien
serveur TypeScript (plugin Vite), retiré après validation de la parité.

Prérequis : Node 24, Rust stable (1.95 ou plus) et, sous Windows, WebView2
(présent sur Windows 11).

```sh
npm install
```

## Mode navigateur

| Commande | Ce qui tourne |
|---|---|
| `npm run dev` | `studio-api` (backend Rust) sur `127.0.0.1:5174` **et** Vite sur `http://localhost:5173`, qui « proxifie » `/api` vers lui |
| `npm run dev:vite` | Vite seul (le proxy `/api` attend un backend sur 5174 : `npm run api`, ou l’appli Tauri) |
| `npm run api` | `studio-api` seul (options : `npm run api -- --help`) |

`vite.config.ts` « proxifie » toujours `/api` vers `http://127.0.0.1:5174`.

En mode navigateur, les réglages sont dans `studio/.cache/settings.json`. Au
premier lancement, l’espace de travail actif est `../examples` et les
bibliothèques sont importées de `../libraries.local.json`. Les options
`--workspace` et `--libraries` de `studio-api` (ou `MENU_FORGE_WORKSPACE`,
`MENU_FORGE_LIBRARIES`) imposent un espace ou des bibliothèques **pour la
session seulement**, sans toucher au fichier de réglages : c’est ce qu’il faut
pour les tests automatiques. `--settings <fichier>` choisit un autre fichier.

## Mode Tauri (appli de bureau)

```sh
npm run tauri:dev
```

Tauri lance Vite seul (`npm run dev:vite`), compile la
coquille et ouvre la fenêtre sur `http://localhost:5173`. Le backend tourne
**dans le processus de l’appli**, sur le port 5174 : arrêtez d’abord tout
`studio-api` ou `npm run dev` qui occuperait 5173 ou 5174.

Au démarrage, un écran d’accueil (`public/splash.html`) s’affiche au moins
1,8 s, puis laisse la place à la fenêtre principale dès que sa page a fini de
charger (20 s au plus).

## Construire l’installateur

```sh
npm run tauri:build
```

Produit `src-tauri/target/release/menu-forge.exe` et l’installateur NSIS
`src-tauri/target/release/bundle/nsis/menu-forge_<version>_x64-setup.exe`.

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
`libraries.local.json` trouvé : variable `MENU_FORGE_LIBRARIES`, dossier des
réglages, puis celui du dépôt.

## API locale

Routes historiques (identiques à l’ancien serveur TypeScript) : `GET /api/workspace`,
`PUT /api/menus/:id`, `PUT /api/assets/:id`, `GET|PUT /api/textures/…`,
`GET /api/libraries`, `GET /api/libraries/:id/index`,
`GET /api/libraries/:id/raw/…`, `POST /api/libraries/:id/import`.

Routes de l’application :

| Route | Rôle |
|---|---|
| `GET /api/app` | `{ name, version, mode: "browser" \| "tauri", settingsPath, platform, overrides, firstLaunch }` ; `firstLaunch` : le fichier de réglages n’existait pas au démarrage du backend |
| `GET /api/settings` | réglages (voir ci-dessous) |
| `PUT /api/settings` | document partiel, validé strictement, appliqué aussitôt ; renvoie les réglages |
| `GET /api/workspaces` | `{ active, workspaces: [{ path, name, lastOpened, active, exists, menus, assets, textures }] }` |
| `POST /api/workspaces/open` | `{ path, name? }` : dossier absolu existant ; crée `menus/`, `assets/`, `textures/` s’ils manquent ; devient l’espace actif |
| `DELETE /api/workspaces` | `{ path }` : retire de la liste (409 pour l’espace actif), **ne supprime aucun fichier** |
| `GET /api/documents/recent` | `[{ type: "menu" \| "asset" \| "pixel", id, name, modified, texture? }]`, du plus récent au plus ancien ; `texture`  PNG exporté d’une image de pixels |
| `GET /api/pixels` | images de l’éditeur de pixels : `[{ id, name, width, height, layers, texture, modified }]` (sans les calques) |
| `GET /api/pixels/:id` | le document `pixels/<id>.pixel.json` complet (format dans [`../docs/pixels.md`](../docs/pixels.md)) |
| `PUT /api/pixels/:id` | enregistre le document après validation (taille, calques PNG, texture d’export sous `textures/`) ; écriture atomique |
| `POST /api/documents/rename` | `{ type, from, to, name? }` : change l’identifiant d’un menu ou d’un asset (fichier et champ `id`) ; 404 si `from` manque, 409 si `to` existe ; textures copiées sous le nouveau nom, jamais déplacées |
| `POST /api/documents/duplicate` | même corps : copie sous `to`, l’original reste |
| `POST /api/documents/trash` | `{ type, id }` : déplace le document dans `<espace>/.trash/<date>/`, **ne supprime jamais rien** ; renvoie `{ type, id, trashed }` |
| `POST /api/libraries` | `{ id, name, root, ownership }` : `root` absolu, contenant `assets/` |
| `DELETE /api/libraries/:id` | débranche le pack (rien n’est supprimé sur le disque) |
| `POST /api/libraries/:id/reindex` | reconstruit l’index sans cache ; renvoie `{ id, textures, fonts }` |

Forme des réglages :

```json
{
  "version": 1,
  "activeWorkspace": "C:\\Users\\…\\Documents\\menu-forge",
  "workspaces": [{ "path": "C:\\…\\menu-forge", "name": "menu-forge", "lastOpened": "2026-09-10T08:00:00.000Z" }],
  "libraries": [{ "id": "vanilla", "name": "Minecraft 1.21.5", "root": "C:\\…\\vanilla-1.21.5", "ownership": "third-party" }],
  "ui": { "defaultZoom": 0, "showGrid": true, "confirmations": { "delete": true, "discardChanges": true } },
  "export": { "enderiumResources": null, "namespace": "menuforge", "packFormat": 46 }
}
```

`ui.defaultZoom` va de 0 à 12 : 0 (par défaut) signifie « Ajuster », le plus
grand palier qui tient dans la toile.

`PUT /api/settings` fusionne `ui`, `ui.confirmations` et `export` clé par clé ;
`workspaces` et `libraries` sont remplacés en entier. Toute clé inconnue est
refusée (400, message en français). Les chemins nouveaux ou modifiés doivent
être absolus et exister ; renvoyer tel quel ce qu’on a lu ne change rien.

Le serveur n’écoute que sur 127.0.0.1 et refuse tout en-tête `Host` ou
`Origin` non local (protection contre le « DNS rebinding » et les requêtes
intersites).

## Export

Deux exports, depuis l’éditeur de menus : boutons **Exporter** et **Pack ZIP**
de la barre d’outils, menu contextuel de la toile, Ctrl+E et Ctrl+Maj+E. Le
menu ouvert est d’abord enregistré s’il a changé ; tous les menus de l’espace
sont exportés, **gabarits appliqués** (les gabarits eux-mêmes ne le sont pas).

| Export | Ce qui est écrit | Où |
|---|---|---|
| Vers le plugin | Menus résolus (sans `extends`, `template` ni métadonnées `generator`) et PNG qu’ils utilisent | `<dossier des paramètres « Export vers le plugin »>/menuforge/` (`menus/`, `textures/`) et le manifeste `.menu-forge-export.json` |
| Pack ZIP de test | Polices et textures générées (même algorithme que la lib), `pack.mcmeta` (`pack_format` des paramètres) | `<espace>/exports/<namespace>-pack.zip` |

Un export vers le plugin ne supprime que les fichiers listés par le manifeste
du précédent et absents du nouveau : un fichier déposé à la main n’est jamais
touché.

**Où vit la génération.** En TypeScript (`src/export/`), à côté de
`compose.ts` et `resolve.ts` : l’export produit exactement ce que montre
l’éditeur, et un seul code TypeScript suit la lib. Lecture et écriture des PNG
sans canvas (les pixels semi-transparents restent exacts) et archive zip, par
les flux de compression standard. Le backend Rust ne fait qu’écrire, dans ces
deux dossiers seulement (`POST /api/export/plugin`,
`PUT /api/exports/<nom>.zip`, voir l’en-tête de `backend/src/app.rs`). La
parité avec la lib est vérifiée par une fixture partagée (`npm test`).

Le pack ZIP ne contient pas le `generic_54.png` « cases seules » (visuel de
coffre fourni par le pack du serveur) : dans un coffre vanilla, le cadre reste
visible sous les couches.

## Tests

```sh
cd backend && cargo test   # backend Rust
npm test                   # génération du pack : PNG, zip, parité avec la lib
```

`npm test` exécute `tests/*.test.ts` avec Node (types retirés à la volée,
`tests/resolve-ts.mjs` résout les imports sans extension).

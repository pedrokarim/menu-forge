# Feuille de route

État vivant du projet : à mettre à jour après chaque étape.

## Fait (2026-09-10)

- **Modèle de rendu** mesuré sur un pack de référence étudié en local :
  [`rendering.md`](rendering.md) (coordonnées, formule de l’`ascent`, règle
  d’avance, pixel témoin).
- **Format v1** : [`format.md`](format.md) (couches, textes, slots, état,
  conditions, actions, gabarits).
- **Studio** (`studio/`) :
  - toile au pixel près, fond « cases seules » ou coffre vanilla, zoom ;
  - couches générées (panneau, bouton, cellule, voile, aplat) ou importées
    (PNG), déplaçables à la souris et aux flèches, réordonnables ;
  - textes dynamiques avec variables et alignement ;
  - zones de slots dessinées sur la grille (outil `S`), types bouton, liste,
    dépôt, décoration ; actions au clic ;
  - conditions d’affichage et d’activation, variables d’état, aperçu d’un état ;
  - **titre composé** affiché en direct, avec le même algorithme que la lib ;
  - 4 gabarits (coffre classique, modale, liste paginée, barre d’onglets) et
    héritage (`extends`) ;
  - annuler / rétablir, enregistrement dans l’espace de travail via une API
    locale qui refuse toute écriture hors du dossier.
- **Lib Java** (`lib/`, détails dans [`../lib/README.md`](../lib/README.md)) :
  - `menu-forge-core` (Java 17, Gson seulement) : parseur avec chemin de la
    clé fautive, gabarits, conditions, mesure des PNG, composition du titre,
    génération du pack (une police par menu, polices de texte par `ascent`) ;
  - `menu-forge-paper` : plugin Paper autonome `MenuForge` (Paper 1.20.6 minimum),
    API + SPI (`ListProvider`, `FlagProvider`, `PlaceholderResolver`,
    `ItemFactory`, `CustomActionHandler`), sessions avec pile pour `back`,
    clics verrouillés sauf slots `input`, commandes `/menuforge open`,
    `reload`, `calibrate`.

## Vérifié

- Studio : typecheck, build et lint sans avertissement.
- Lib : `./gradlew build` réussi, 32 tests du noyau, 0 échec.
- **Calibration en jeu** (2026-09-10, Paper 1.20.6) : placement horizontal et
  vertical exact au pixel (formule de l’`ascent`, avances, recadrage),
  largeurs des caractères testés et alignements gauche / centre / droite
  (détails dans [`rendering.md`](rendering.md)).
- **Ordre de rendu** : les items passent au-dessus des couches du titre
  (test du slot (4, 0) du menu de calibration).
- Chaîne complète sur le serveur de test : MenuForge génère ses polices, elles
  sont ajoutées au pack d’Enderium, envoyées au client et affichées.
- API locale : lecture, écriture de menu et de texture, refus d’un non-PNG et
  d’un chemin qui sort de l’espace de travail (tests `curl`).
- Interface : chargement d’un menu, rendu des couches, textes, zones et titre
  composé (capture Edge headless).

## Pas encore vérifié

- Les interactions à la souris dans un vrai navigateur : glisser une couche,
  dessiner une zone, générateur, création depuis un gabarit.
- Largeurs des caractères non encore affichés en jeu (table ASCII complète).
- `/profile` d’Enderium ouvert par un vrai client : le serveur de test charge
  MenuForge et l’adaptateur et fusionne les polices dans le pack sans erreur,
  mais aucun joueur ne s’y est connecté (rendu, clics, retour de la modale).
- La grille des caractères accentués d’`ascii.png` (lignes 0–1 et 8–15) est
  reprise de mémoire ; une erreur n’affecterait que ces caractères.
- `pack_format` 46 par défaut, à ajuster selon la version du serveur.

## Décision : le studio devient une appli Tauri (2026-09-10)

Le studio vit sur le disque (packs lus, PNG, polices et menus écrits) : il
devient une **application de bureau Tauri**.

- **Gardé tel quel** : toute l’interface React (toile, inspecteur, gabarits,
  bibliothèque, moteur de texte Minecraft, mode libre).
- **Réécrit en Rust** : le serveur local en TypeScript (espace de travail,
  menus, assets, textures, bibliothèques et leur index). Il sera exposé par un
  **protocole d’URL maison** qui reproduit les routes `/api/...` actuelles,
  pour que l’interface ne change presque pas.
- **Mode navigateur conservé** pour le développement et les tests
  automatiques (même backend servi en HTTP).
- **Pas d’interface en Rust natif** (egui, iced, Slint) : on jetterait tout le
  travail d’interface, pour un résultat moins bon sur ce type d’éditeur.
- Ordre : finir le mode libre et le nouveau style, puis migrer, puis profiter
  du natif (sélecteur de dossiers, lecture directe des zips de packs,
  glisser-déposer depuis l’explorateur, export direct vers le plugin).

## Appli Tauri : état (2026-09-10)

Le **protocole d’URL maison** prévu ci-dessus est abandonné au profit d’un
serveur HTTP local : l’appli lance le backend Rust dans son propre processus
(`127.0.0.1`, port libre) et ce même serveur sert aussi l’interface, donc la
page et `/api` partagent la même origine et l’interface ne change pas.
Détails et commandes : [`../studio/README.md`](../studio/README.md).

- **Backend** (`studio/backend/`, crate `studio-backend`) : boucle HTTP dans
  la lib (`server::serve`, port réel renvoyé, arrêt propre), `studio-api`
  n’est plus qu’une enveloppe ; contrôle `Host` / `Origin` gardé.
- **Réglages persistants** (JSON, écriture atomique) : espaces de travail
  connus, espace actif, bibliothèques (importées de `libraries.local.json` au
  premier lancement), préférences d’interface et d’export. Espace actif et
  bibliothèques modifiables à chaud, index en mémoire conservés.
- **Nouvelles routes** : `/app`, `/settings`, `/workspaces`,
  `/workspaces/open`, `/documents/recent`, ajout, retrait et réindexation des
  bibliothèques. Routes historiques inchangées (test de parité avec le TS).
- **Coquille** (`studio/src-tauri/`, crate `menu-forge`) : Tauri 2, plugins
  `dialog` et `opener`, capacité limitée à `http://127.0.0.1:*` (sélecteur de
  dossier, « montrer dans l’explorateur »), navigation bloquée hors de
  l’origine de l’interface, écran de démarrage puis fenêtre principale,
  installateur NSIS.
- **Mode navigateur** conservé : `npm run dev` lance le backend Rust
  (`studio-api`) derrière le proxy de Vite.
- **Bascule faite** (2026-09-11) : l’ancien serveur TypeScript (plugin Vite)
  est retiré, le backend Rust est le seul backend.

Reste à faire : brancher les écrans (choix d’espace, sélecteur de dossier,
réglages, récents) sur ces routes.

## Chaîne jusqu’au jeu (2026-09-11)

- **Plugin testé** : 28 tests sur un serveur simulé (MockBukkit, paper-api
  1.20.6) : ouverture et titre, clics verrouillés sauf `input`, `setState`,
  pagination, pile `open` / `back`, actions `custom`, drapeaux, variables,
  commandes, espaces de travail supplémentaires.
- **API de la lib** : espaces de travail supplémentaires (`addWorkspace` : un
  plugin embarque ses menus), écouteurs de rechargement, retrait des SPI,
  publication Maven locale.
- **Export depuis le studio** : « Exporter vers le plugin » (menus résolus et
  textures, dans le dossier réglé, avec un manifeste) et « Pack ZIP » de test
  (polices, textures, `pack.mcmeta`). Génération en TypeScript ; parité avec la
  lib vérifiée par une fixture partagée (polices octet pour octet, textures
  pixel pour pixel, titres).
- **Adaptateur Enderium** (dans enderium-core) : actions `custom` →
  ClickActions, drapeaux → requirements, placeholders, items, polices
  fusionnées dans le pack actif ; lib consommée en build composite.
- **Premier vrai menu** : `/profile` d’Enderium recréé avec des textures
  générées par le studio ; le serveur de test le charge (29 fichiers ajoutés
  au pack d’Enderium).

## Prochaines étapes

1. **Calibration en jeu** : ouvrir le menu de calibration de la lib et
   confirmer (ou corriger) le modèle de rendu.
2. **Valider `/profile` en jeu** avec un client, puis migrer les autres
   écrans du prototype d’Enderium (succès, royaumes, maisons).
3. **Studio** :
   - police pixel fidèle pour l’aperçu des textes ;
   - éditeur visuel des états et des actions (sans passer par le JSON) ;
   - copier / coller, multi-sélection, repères.
4. **Décider** du sort de `generic_54.png` (effet global sur tous les coffres).

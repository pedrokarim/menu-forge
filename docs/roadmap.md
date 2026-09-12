# Feuille de route

État au 2026-09-12. Page vivante, à mettre à jour après chaque étape ; le
détail de chaque fonction est dans sa page de référence (voir le
[sommaire](README.md)).

## Où en est le projet

Jeune projet, en développement actif, sans version publiée : on construit
depuis les sources. Le rendu Java est validé en jeu (Paper 1.20.6), les
formulaires Bedrock le sont sur un client Bedrock avec mc-rs, et le studio,
la lib et les deux exports fonctionnent de bout en bout.

## Fait

### Rendu et format

- **Modèle de rendu** mesuré sur un pack de référence étudié en local, puis
  validé en jeu : [`rendering.md`](rendering.md).
- **Format v1** : couches, textes, slots, état, conditions, actions,
  gabarits, composants (`component`, `includes`) et formulaires Bedrock
  (`form`), avec les schémas JSON des menus et des assets :
  [`format.md`](format.md).

### Studio

- **Application** Tauri 2 et mode navigateur, backend Rust (serveur HTTP
  local qui sert l’interface et l’API sur la même origine) ; écrans Accueil,
  Espaces de travail, Éditeur, Bibliothèques, Paramètres, À propos :
  [`screens.md`](screens.md).
- **Éditeur de menus** : toile au pixel près, couches générées ou importées,
  rognage des atlas, textes dynamiques, zones de slots, titre composé en
  direct, gabarits et héritage.
- **Gestes d’édition** : sélection multiple, presse-papiers du système,
  aligner et répartir, verrouiller et masquer, renommer, dupliquer ou mettre à
  la corbeille un document, glisser-déposer d’un PNG.
- **Éditer sans JSON** : actions au clic, conditions en arbre, variables
  d’état, items MiniMessage ; mode **Essayer** ; **composants** réutilisables.
- **Mode libre** ([`assets.md`](assets.md)) et **éditeur de pixels**
  ([`pixels.md`](pixels.md)).
- **Générateur d’interfaces** : cinq types, trois familles de styles, aperçu
  cliquable et **galerie de 22 exemples** ([`generator.md`](generator.md)).
- **Police pixel de Menu Forge**, aux avances du jeu
  ([`rendering.md`](rendering.md#aperçu-dans-le-studio)).
- **Génération par IA** : onze fournisseurs, textures et interfaces
  contraintes, **tâches de fond** avec progression lue au backend, étapes,
  chronomètre, journal des essais et annulation, **notifications** et
  indicateur du rail ([`ai.md`](ai.md)).
- **Confort** : colonnes latérales redimensionnables et mémorisées,
  raccourcis de zoom (`Z`, `+`, `-`, `Maj+0`, `Maj+1`, `Maj+2`), fenêtre
  bornée à la zone utile de l’écran (1024 × 600 au moins), passage à la ligne
  au lieu des textes coupés, accueil sur une grille commune
  ([`shortcuts.md`](shortcuts.md)).

### Export et serveurs

- **Exports** vers le plugin, en pack ZIP de test et pour Bedrock :
  [`export.md`](export.md).
- **Lib Java** : noyau autonome et plugin Paper **MenuForge**, avec son API
  et ses points d’extension : [`lib/README.md`](../lib/README.md).
- **Adaptateur d’Enderium** (dans enderium-core) : actions `custom` branchées
  sur ses ClickActions, drapeaux sur ses conditions, placeholders, polices
  fusionnées dans son pack ; son écran `/profile` est recréé avec des textures
  générées par le studio.
- **Bedrock** : exporteur, formulaires Bedrock, moteur Menu Forge de mc-rs
  (`/mf open`, `list`, `reload`) et portage des écrans de `/menu` de mc-rs :
  [`bedrock.md`](bedrock.md).

### Tests

- `npm test` (studio) : schéma sur les gabarits et les exemples, parité avec
  la lib, pack et export, textures générées, générateur d’interfaces et
  galerie, export Bedrock et formulaires, génération par IA (contrainte,
  correction bornée, tâches de fond), police pixel.
- `cargo test` (backend) : routes, chemins refusés, formats, fournisseurs
  d’IA factices, progression et annulation.
- `npm run e2e` : 13 scénarios et 61 tests dans un vrai navigateur, dont un
  **détecteur de mise en page** (débordements, textes coupés, chevauchements,
  dialogues recouverts) à huit tailles, de 1024 × 600 à 1600 × 900.
- `./gradlew build` (lib) : noyau et fixtures de parité (47 tests au dernier
  lancement), plugin sur un serveur simulé (28 tests).

## Vérifié

- **En jeu, Java** (2026-09-10, Paper 1.20.6) : placement horizontal et
  vertical exact au pixel (formule de l’`ascent`, avances, recadrage),
  largeurs des caractères testés, alignements gauche, centre et droite ;
  items dessinés au-dessus des couches du titre ; chaîne complète sur le
  serveur de test d’Enderium (polices générées, ajoutées à son pack, envoyées
  au client et affichées).
- **En jeu, Bedrock** (2026-09-12, client Bedrock, mc-rs) : fond et couches
  au pixel, grille de boutons, formulaires Bedrock, commandes `/mf`.
- **Hors jeu** : avances des 95 caractères ASCII imprimables recalculées
  depuis le vrai `ascii.png` de Minecraft 1.21.5.

## Pas encore vérifié

- `/profile` d’Enderium ouvert par un vrai client (le serveur de test le
  charge sans erreur, mais aucun joueur ne s’y est connecté).
- La grille des caractères accentués d’`ascii.png` (lignes 0–1 et 8–15) et
  l’avance de ’ « » … – en jeu ; l’ordre de rendu titre / items en 1.21.x ;
  les très grands `ascent` négatifs.
- `pack_format` 46 par défaut, à ajuster selon la version du serveur.
- La génération par IA avec de vraies clés : identifiants des modèles par
  défaut, transparence réelle des images, refus de contenu, délais, images de
  Codex.
- La fenêtre bornée sur un vrai écran à 150 % ; le glisser-déposer dans la
  vraie fenêtre Tauri.
- Bedrock : onglets de la boutique, sous-titres collés au titre, étiquette de
  texte dynamique qui déborde de sa case ([`bedrock.md`](bedrock.md#4-les-entrées-du-formulaire)).

## Prochaines étapes

1. Valider `/profile` en jeu avec un client, puis migrer les autres écrans
   d’Enderium (succès, royaumes, maisons).
2. Studio : repères posés à la main (règles, guides), restaurer un document
   depuis la corbeille, surcharger un seul champ d’un élément d’instance,
   aperçu des slots « liste » en mode Essayer.
3. Éditeur de pixels : animations et planches de sprites, palettes
   enregistrées, dégradés et trames, sélection elliptique, rotation libre.
4. Générateur d’interfaces : trancher les défauts relevés sur la galerie.
5. IA : essayer chaque fournisseur avec une vraie clé ; retouche d’image
   guidée, plusieurs variantes à la fois.
6. Bedrock : passer par Geyser et Floodgate (E4), aperçu Bedrock avancé
   (E5), rendu « coffre surchargé » pour les slots `input` (E6).
7. Format : conteneurs autres que le coffre (`hopper`, `dispenser`…),
   animations.
8. Décider du sort de la texture globale du coffre (`generic_54.png`).

## Décisions

- **Le studio est une application Tauri** (2026-09-10) : l’interface React
  est gardée, le serveur local est réécrit en Rust. Le protocole d’URL maison
  prévu d’abord est abandonné au profit d’un serveur HTTP local qui sert
  l’interface et l’API sur la même origine ; le mode navigateur reste pour le
  développement et les tests.
- **Un plugin Paper à part** (MenuForge) plutôt qu’une lib embarquée : un
  plugin qui relocalise Adventure casserait ses appels natifs
  ([`lib/README.md`](../lib/README.md)).
- **Bedrock par formulaires serveur** dessinés en JSON UI, après l’essai E0
  ([`bedrock.md`](bedrock.md#1-principe)).
- **Documentation** : une information à un seul endroit ; le site en publie
  les pages, générées depuis `docs/` ([`site/README.md`](../site/README.md)).

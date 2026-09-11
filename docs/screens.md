# Écrans de l’application

Le studio devient un logiciel à plusieurs écrans (appli Tauri, style
« Deepslate »). Ce document fixe la navigation et le contenu de chaque écran,
avant de les construire.

## Navigation

- **Rail d’écrans** vertical à gauche, étroit (icônes Pixelarticons +
  infobulle Deepslate avec le raccourci) : Accueil, Éditeur, Bibliothèques,
  Paramètres, À propos. L’écran actif est marqué en or.
- **Pastille de l’espace de travail** en haut de chaque écran : nom de
  l’espace actif ; un clic ouvre l’écran Sélection.
- **Adresse** : l’écran courant est reflété dans l’URL (`#/accueil`,
  `#/editeur/menus/<id>`, `#/editeur/assets/<id>`, `#/editeur/pixels/<id>`,
  `#/bibliotheques`,
  `#/parametres`, `#/a-propos`, `#/espaces`) pour pouvoir y revenir
  directement ; pas de dépendance de routage, un petit routeur maison suffit.
- **Quitter l’éditeur** avec des changements non enregistrés : confirmation
  (règle déjà en place, étendue au changement d’écran).
- **Raccourcis globaux** : `Ctrl+1…5` pour les écrans, `Ctrl+O` pour la
  sélection d’espace, `?` pour l’aide-mémoire des raccourcis.

## Premier lancement

1. Pas d’espace de travail connu → écran **Sélection**, avec un espace par
   défaut proposé (`Documents/menu-forge`, créé si besoin).
2. Espace choisi → **Accueil**.

## Écrans

### Accueil (`#/accueil`)

- En-tête : logo pixel menu-forge, nom de l’espace actif.
- **Actions rapides** (grandes cases façon inventaire) : Nouveau menu, Nouvel
  asset, Nouvelle image, Importer un écran depuis une police, Ouvrir un espace
  de travail.
- **Documents récents** de l’espace actif : menus, assets et images de pixels triés par date,
  avec vignette (rendu du fond ou de l’asset), type, nom, date relative ;
  clic = ouvrir dans l’éditeur ; clic droit ou bouton « … » : Ouvrir,
  Renommer…, Dupliquer, Mettre à la corbeille (le fichier va dans `.trash/`
  de l’espace, rien n’est supprimé).
- **Espaces récents** (3 à 5), clic = basculer.
- États vides utiles : « Aucun document : commence par un gabarit ».
- Données : `GET /documents/recent`, `GET /workspaces`.

### Sélection de l’espace de travail (`#/espaces`)

- Liste des espaces connus : nom, chemin, nombre de menus / assets / textures,
  dernier accès, alerte si le dossier n’existe plus.
- **Ouvrir un dossier…** (sélecteur natif Tauri ; en mode navigateur, saisie
  du chemin), **Retirer de la liste** (ne supprime jamais de fichiers),
  **Afficher dans l’explorateur**.
- Données : `GET /workspaces`, `POST /workspaces/open`, `DELETE /workspaces`.

### Éditeur (`#/editeur/...`)

L’existant : bascule Menus / Assets, toile, bibliothèque, inspecteur, aperçu
d’état, titre composé. S’y ajoutent la manipulation directe (slots déplaçables
et redimensionnables, aimantation) et les infobulles.

**Rognage (sprites d’atlas).** Beaucoup de textures des packs sont des atlas :
une grande image, plusieurs sprites. « Rogner… » (bibliothèque, ou couche
sélectionnée dans l’inspecteur) ouvre un sélecteur à trois modes : tracer une
zone, cliquer une case d’une grille (8, 16, 18, 32, 64 ou taille libre, avec
décalage), cliquer un sprite (zone détectée sur les pixels opaques reliés).
« Ajouter et continuer » pose plusieurs sprites à la suite.

- Menus : la découpe devient sa propre texture (`textures/cropped/`), car
  chaque couche finit en glyphe de police ; rogner une couche la décale pour
  que la partie gardée reste en place, « Extraire en nouvelle couche » garde
  l’originale.
- Assets : l’image garde la texture entière et n’en affiche que la zone source.
- `Ctrl+D` duplique la sélection (couches, textes, zones, éléments d’asset).

**Gestes d’édition.** Maj ou Ctrl + clic ajoute ou retire un élément de la
sélection, un rectangle tracé sur une zone vide sélectionne ce qu’il touche,
`Ctrl+A` prend tout ce qui n’est ni verrouillé ni masqué. Copier, couper,
coller (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`) passent par le presse-papiers système
(JSON marqué) ; une image PNG collée ou glissée depuis l’explorateur devient
une texture puis une couche (menus) ou une image (assets). L’inspecteur d’une
sélection multiple résume ce qui est commun et porte la barre « Aligner et
répartir » (par rapport à la sélection ou à la toile). Verrouiller retire un
élément de la toile (il reste dans la liste) ; masquer le cache de la toile
seulement pour un menu, de l’export pour un asset. Les assets ont des groupes
(`Ctrl+G`, `Ctrl+Maj+G`). Le bouton « … » à côté du sélecteur de document
renomme, duplique ou met à la corbeille le document ouvert.

**Éditer sans JSON.** L’inspecteur d’un slot édite ses actions au clic
(liste réordonnable au glisser, aux flèches ou à Alt+↑ / Alt+↓, ajout par
type, champs propres à chaque type avec listes des menus, des variables et des
listes paginées, validation en direct), son item (invisible, matériau, tête,
référence du serveur, nom et description en MiniMessage avec aperçu coloré et
palette de balises) et ses conditions (arbre « toutes », « au moins une »,
« pas », feuilles « état égal à », « état parmi », « drapeau », résumé en une
ligne, accès « Avancé (JSON) » pour les cas exotiques). Sans sélection,
l’inspecteur du menu édite ses variables d’état (renommer une variable met à
jour ses références) et ses composants inclus.

**Essayer** (`E`, `Échap` pour revenir). Un clic sur un slot de la toile
exécute ses actions sur l’état d’aperçu, comme en jeu : `setState`,
pagination, `open` (le menu ouvert s’affiche, une pile garde le chemin pour
`back`), `close` (message, puis « Rouvrir ») ; commandes, sons et actions
serveur sont écrits au journal (colonne de gauche). Le titre composé suit en
direct. Rien n’est modifié dans le document.

**Composants.** « Créer un composant… » (menu contextuel d’une sélection)
déplace les éléments dans un nouveau fichier `component: true` et laisse une
instance à leur place. Dans les propriétés du menu, « Composants inclus »
pose, décale, préfixe ou conditionne des instances, ouvre le composant ou
détache une instance. Les éléments d’instance sont listés avec la pastille
« composant » et ne se modifient que dans leur composant (format :
[`format.md`](format.md) § Composants).

**Éditeur de pixels** (`#/editeur/pixels/<id>`, troisième mode après Menus et
Assets). Pour dessiner une texture au pixel près : couleurs à gauche (principale
et secondaire, palette, récentes, couleurs du document), outils et toile au
centre, calques et propriétés de l’image à droite. Chaque enregistrement écrit
le document `pixels/<id>.pixel.json` (calques) et un PNG aplati dans
`textures/`, utilisable tel quel dans les menus et les assets. « Ouvrir dans
l’éditeur de pixels » (menu contextuel d’une vignette de bibliothèque ou d’une
couche) crée une image depuis une texture ; celle d’un pack n’est jamais
modifiée (copie). Format, outils et raccourcis : [`pixels.md`](pixels.md).

La fenêtre descend à 1180 × 700 : en dessous, rail d’écrans et trois colonnes
ne laissent plus à la toile la place de ses outils.

### Bibliothèques (`#/bibliotheques`)

- Liste des packs branchés : nom, chemin, badge « maison » / « tiers · local »,
  nombre de textures et de polices, date d’indexation.
- **Ajouter un pack** (dossier d’un resource pack extrait ; plus tard : zip
  lu directement), modifier le nom et la propriété, **Réindexer**, **Retirer**.
- Rappel visible : les assets tiers restent sur ce poste, jamais publiés.
- Données : `GET /libraries`, `POST /libraries`, `DELETE /libraries/:id`,
  `POST /libraries/:id/reindex`.

### Paramètres (`#/parametres`)

- **Espace de travail** : espace ouvert au démarrage.
- **Éditeur** : zoom par défaut, grille, aimantation, confirmations.
- **Export vers le plugin** : dossier des ressources d’enderium-core,
  namespace, `pack_format` (32 = 1.20.5/1.20.6, 34 = 1.21, 46 = 1.21.4).
- **Avancé** : chemin du fichier de réglages, vider les caches d’index.
- Données : `GET /settings`, `PUT /settings`, `GET /app`.

### À propos (`#/a-propos`)

- Logo, version, mode (appli ou navigateur), chemin des réglages.
- **Licences** : Pixelarticons (MIT), Pixelify Sans, Atkinson Hyperlegible,
  JetBrains Mono (OFL 1.1), React, Tauri.
- Mention : « menu-forge n’est ni affilié à Mojang ni approuvé par Mojang ;
  Minecraft est une marque de Mojang AB. Les assets de packs tiers affichés dans
  la bibliothèque restent la propriété de leurs auteurs. »

### Aide-mémoire des raccourcis (`?`)

Fenêtre modale au style infobulle Deepslate, regroupée par contexte :
navigation, éditeur de menus, éditeur d’assets, éditeur de pixels, toile.

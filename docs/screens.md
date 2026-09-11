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

- En-tête : logo pixel de Menu Forge, nom de l’espace actif.
- **Actions rapides** (grandes cases façon inventaire) : Nouveau menu, Générer une
  interface, Nouvel
  asset, Nouvelle image, Importer un écran depuis une police, Ouvrir un espace
  de travail.
- **Documents récents** de l’espace actif : menus, assets et images de pixels triés par date,
  avec vignette (rendu du fond ou de l’asset), type, nom, date relative ;
  clic = ouvrir dans l’éditeur ; clic droit ou bouton « … » : Ouvrir,
  Renommer…, Dupliquer, Mettre à la corbeille (le fichier va dans `.trash/`
  de l’espace, rien n’est supprimé).
- **Générer une interface…** (en tête des actions rapides) : décrite à une
  IA, validée, ouverte dans l’éditeur sans être enregistrée (voir
  [`ai.md`](ai.md)).
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

**Générer une interface.** « Nouveau menu » propose « Générer une
interface… », aussi action rapide de l’accueil. On choisit un type – boutique
(grille d’articles paginée et barre d’actions), grille simple, modale de
confirmation, liste paginée, barre d’onglets –, le nombre de lignes du coffre,
le nombre et la disposition des boutons (à gauche, centrés, à droite,
répartis), la famille de styles (Deepslate, mc-rs ou sombre à accent) et une couleur d’accent ;
l’aperçu suit en direct, et un clic sur un onglet ou une flèche y change
l’état. Le menu créé est complet : couches aux textures générées (fond et
cases, boutons, variantes allumées ou actives), zones de slots et leurs
actions (`setState` pour les onglets, `nextPage` / `prevPage` pour les pages,
`back`, `close`, actions du serveur), textes et variables d’état. Il se
retouche ensuite à la main comme n’importe quel menu ; « Modifier la texture
générée… » rouvre chaque couche dans le générateur de textures.

**Générateur de textures.** « Générer une texture… » dessine une couche au
pixel près, dans un style Deepslate (biseauté façon vanilla), mc-rs
(panneaux sombres et arrondis, boutons plats à trois états, boutons en relief,
bandes, cases, grille de chargement) ou sombre à accent (fenêtre plate à cadre
fin, cases creusées, onglets et boutons plats, bouton fermer, store rayé,
lignes de liste, cartouches, barres de progression), avec aperçu et paramètres propres à la
famille (rayon, bordure, accent, état, ombre, progression). Format : [`format.md`](format.md)
§ Couches.

**Éditeur de pixels** (`#/editeur/pixels/<id>`, troisième mode après Menus et
Assets). Pour dessiner une texture au pixel près : couleurs à gauche (principale
et secondaire, palette, récentes, couleurs du document), outils et toile au
centre, calques et propriétés de l’image à droite. Chaque enregistrement écrit
le document `pixels/<id>.pixel.json` (calques) et un PNG aplati dans
`textures/`, utilisable tel quel dans les menus et les assets. « Ouvrir dans
l’éditeur de pixels » (menu contextuel d’une vignette de bibliothèque ou d’une
couche) crée une image depuis une texture ; celle d’un pack n’est jamais
modifiée (copie). Format, outils et raccourcis : [`pixels.md`](pixels.md).

**Génération par IA.** « Générer une interface… » (bouton à côté de
« Nouveau », menu contextuel de la toile, dialogue « Nouveau menu ») :
description, fournisseur de texte, taille du coffre ; la réponse est validée
par le schéma et les règles de la lib, corrigée en quelques essais au plus,
puis le menu s’ouvre **non enregistré**. « Générer une texture… » (barre de
l’éditeur de pixels, bibliothèque) : description, fournisseur d’images,
taille, palette ; l’image est ramenée sur la grille des pixels, en palette
imposée, avec une vraie transparence, puis ouverte dans l’éditeur de pixels.
Fournisseurs, confidentialité et contraintes : [`ai.md`](ai.md).

**Formulaire Bedrock.** Un menu créé avec une disposition Bedrock
(« Nouveau menu », section « Formulaire Bedrock ») s’ouvre dans son propre
éditeur, chargé à la demande. Colonne de gauche : la disposition (huit, celles
du pack `mcrs_ui`), le titre et le contenu, puis la liste des boutons – glisser
pour réordonner, clic droit pour dupliquer, monter, descendre ou supprimer,
« Ajouter » pour un bouton, une bannière ou un bouton spécial selon la
disposition ; l’onglet « Bibliothèque » fait d’une texture l’icône du bouton
sélectionné. Au centre, l’aperçu reprend la géométrie des JSON du pack, sur un
écran simulé (PC, grand ou petit écran) ; « Essayer » (`E`) exécute les
actions d’un clic comme le serveur. À droite, l’inspecteur du bouton :
identifiant, texte, sous-titre, rôle, icône (texture de l’espace, PNG importé,
icône de 32 × 32 dessinée dans l’éditeur de pixels, texture du jeu citée par son
chemin, adresse web), « Envoyé si » (`visibleWhen`) et actions au clic ; puis
les variables d’état et l’aperçu des drapeaux. Les textes et chemins longs
passent à la ligne : rien ne déborde de la colonne. Format :
[`format.md`](format.md) § Formulaire Bedrock ; export : [`bedrock.md`](bedrock.md) § 9.

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
- **Export pour Bedrock** : dossier du serveur Bedrock, qui reçoit le pack
  (`pack/`) et `runtime.json` ; pour mc-rs, `menu_forge/export`.
- **IA** : une fiche par fournisseur (OpenAI, Google Gemini, Anthropic,
  Mistral, Stability AI, fal, Replicate, ComfyUI, Automatic1111, Ollama,
  Codex CLI) : activer, clé d’API rangée dans le trousseau du système
  (l’écran n’affiche que « configurée »), modèles, adresse locale, test de
  connexion. Chargée à la demande. Voir [`ai.md`](ai.md).
- **Avancé** : chemin du fichier de réglages, vider les caches d’index.
- Données : `GET /settings`, `PUT /settings`, `GET /app`.

### À propos (`#/a-propos`)

- Logo, version, mode (appli ou navigateur), chemin des réglages.
- **Licences** : Pixelarticons (MIT), Pixelify Sans, Atkinson Hyperlegible,
  JetBrains Mono (OFL 1.1), React, Tauri.
- Mention : « Menu Forge n’est ni affilié à Mojang ni approuvé par Mojang ;
  Minecraft est une marque de Mojang AB. Les assets de packs tiers affichés dans
  la bibliothèque restent la propriété de leurs auteurs. »

### Aide-mémoire des raccourcis (`?`)

Fenêtre modale au style infobulle Deepslate, regroupée par contexte :
navigation, éditeur de menus, éditeur d’assets, éditeur de pixels, toile.

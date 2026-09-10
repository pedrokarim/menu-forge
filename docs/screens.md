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
  `#/editeur/menus/<id>`, `#/editeur/assets/<id>`, `#/bibliotheques`,
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
  asset, Importer un écran depuis une police, Ouvrir un espace de travail.
- **Documents récents** de l’espace actif : menus et assets triés par date,
  avec vignette (rendu du fond ou de l’asset), type, nom, date relative ;
  clic = ouvrir dans l’éditeur.
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
navigation, éditeur de menus, éditeur d’assets, toile.

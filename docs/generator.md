# Générateur d’interfaces et de textures

Deux générateurs **procéduraux** : tout est calculé par le studio, au pixel
près, sans modèle d’IA ni fichier d’image. Le générateur d’interfaces crée un
menu complet à partir de quelques réglages ; le générateur de textures dessine
une couche (panneau, bouton, case…). La génération par IA est une autre
fonction, décrite dans [`ai.md`](ai.md).

## Générateur d’interfaces

### Où le trouver

- Accueil : la carte **Générer une interface** des actions rapides, ou
  **Voir les exemples**, qui ouvre directement la galerie ;
- éditeur de menus : **Nouveau**, puis **Générer une interface…** en tête du
  dialogue « Nouveau menu ».

Le dialogue a deux onglets : **Réglages** et **Exemples**. L’aperçu suit
chaque réglage en direct, et un clic sur un onglet ou une flèche de page
change l’état affiché, comme en jeu.

![Le générateur d’interfaces : une barre d’onglets en style « sombre à accent », ses réglages et son aperçu](../site/assets/screens/interface-generator.png)

### Réglages

| Type | Contenu | Lignes | Boutons |
|---|---|---|---|
| Boutique | grille d’articles paginée et barre d’actions | 3 à 6 (6 par défaut) | 0 à 5 boutons de la barre (2) |
| Grille simple | une grille d’items et une rangée de boutons | 2 à 6 (4) | 0 à 9 boutons (1) |
| Modale de confirmation | un message, l’objet concerné et un à trois choix | 3 à 6 (3) | 1 à 3 choix (2) |
| Liste paginée | entrées d’une source, pages précédente et suivante | 3 à 6 (6) | 0 à 5 boutons entre les flèches (1) |
| Barre d’onglets | des onglets qui changent l’état et le contenu affiché | 2 à 6 (6) | 2 à 9 onglets (4) |

S’y ajoutent :

- le **nom**, le **titre** (affiché en haut à gauche de la fenêtre) et
  l’**identifiant** du menu ;
- la **disposition des boutons** : à gauche, centrés, à droite ou répartis ;
- la **famille de styles** et sa **couleur d’accent** :

| Famille | Allure | Accent par défaut |
|---|---|---|
| Deepslate | biseautée, façon vanilla | vert `#52a535` |
| mc-rs | sombre et arrondie, dans l’esprit du pack d’interface de mc-rs | or `#ffd933` |
| Sombre à accent | plate, cadre fin, coins nets | rouge `#e83820` |

### Le menu créé

**Créer le menu** enregistre un menu ordinaire, qui se retouche ensuite comme
n’importe quel autre :

- des **couches** aux textures générées : fond et cases, boutons, variantes
  allumées ou actives (onglet actif, flèche de page allumée), départagées par
  des conditions `visibleWhen` ;
- des **zones de slots** et leurs actions : `setState` pour les onglets,
  `nextPage` et `prevPage` pour les pages, `back`, `close`, commandes et
  actions du serveur (`custom`, par exemple `shop_sell_all` ou `shop_help`,
  à brancher côté serveur) ;
- des **textes** et des **variables d’état** (onglet courant, page).

Les textures générées sont écrites sous `textures/generated/<menu>/`. Chaque
couche garde ses paramètres dans la clé `generator` : « Modifier la texture
générée… » la rouvre dans le générateur de textures.

### Règles de mise en page

- **Icônes des boutons d’une case.** Un libellé ne tient pas dans 16 px : le
  bouton porte une icône pixel peinte dans sa texture (clé `icon`), dans la
  couleur de son libellé. Croix pour « Fermer », flèche de retour pour
  « Retour », sac pour « Tout vendre », bourse pour « Mon solde », point
  d’interrogation pour « Aide », chevrons pour les pages, chiffre 1 à 9 pour
  les actions génériques « Action N ». Le nom complet reste celui de l’item
  invisible, affiché au survol en jeu. En « sombre à accent », « Fermer »
  garde son carré à croix, toujours rouge, quel que soit l’accent.
- **Libellés.** Au moins 4 px de marge intérieure de chaque côté. Un choix de
  modale prend la largeur qu’il lui faut (« Confirmer » et « Plus tard » :
  quatre cases), et les choix gardent la même largeur quand la rangée le
  permet.
- **Contraste.** Libellés et icônes atteignent un contraste d’au moins 3:1
  (seuil WCAG des composants d’interface) sur le corps de leur bouton : la
  couleur de la famille si elle suffit, sinon une couleur claire ou foncée
  selon la luminance du fond. L’onglet actif mc-rs écrit son libellé dans
  l’accent éclairci, jamais dans l’accent pur sur sa propre teinte.
- **Centrage.** Les cases sont entières : quand il reste un nombre impair de
  colonnes libres, « Centrés » et « Répartis » ouvrent une colonne vide au
  milieu du groupe, pour que les marges de gauche et de droite restent
  égales.
- **Numéro de page.** En haut à droite s’il tient à côté du titre ; sinon
  dans la plus longue suite de cases libres de la barre du bas ; sinon le
  titre est raccourci au dernier mot entier, suivi de « … ». Il n’est jamais
  omis. En boutique « sombre à accent », le titre et la cartouche se centrent
  dans le bandeau, sous le store.
- **Fond mc-rs.** Opaque, pour masquer entièrement les cases du coffre
  vanilla ; ses coins ne retirent qu’un pixel, là où la fenêtre vanilla est
  déjà transparente, si bien que son cadre ne dépasse plus.

Le générateur ne redessine que la partie coffre, par le titre du coffre :
l’inventaire du joueur, en dessous, reste celui du jeu (gris clair). Le
couvrir est possible (un fond qui descend jusqu’au bas de la fenêtre, avec
ses propres cases), mais le libellé « Inventaire » que le jeu écrit par-dessus
en gris foncé deviendrait illisible sur un fond sombre : c’est un choix à
faire menu par menu, dans l’éditeur.

## Galerie d’exemples

L’onglet **Exemples** propose 22 interfaces toutes faites, filtrables par
type et par famille. Chaque vignette est rendue en direct par le générateur,
avec la fonction de l’aperçu, à l’échelle 1 et pixelisée, et seulement une
fois visible : aucune image n’est stockée. Sa légende donne le nom, puis le
type, la famille et l’accent, puis les réglages (lignes, boutons,
disposition).

![La galerie d’exemples : filtres par type et par famille, vignettes rendues en direct, l’exemple « Marché » sélectionné](../site/assets/screens/interface-examples.png)

- **Un clic** charge les réglages de l’exemple dans le formulaire, nom, titre
  et identifiant libre compris ;
- **Personnaliser** passe aux réglages pour les retoucher avant de créer le
  menu ;
- **Un double-clic**, ou **Utiliser cet exemple**, crée le menu tel quel,
  sous un identifiant libre tiré de son nom.

| Nom | Type | Famille | Accent | Lignes | Boutons | Disposition |
|---|---|---|---|---|---|---|
| Boutique | boutique | Deepslate | vert | 6 | 2 | centrés |
| Marché | boutique | mc-rs | or | 6 | 5 | centrés |
| Forge | boutique | sombre à accent | rouge | 5 | 3 | répartis |
| Primeur | boutique | sombre à accent | vert marché | 4 | 4 | répartis |
| Échoppe | boutique | mc-rs | orange | 3 | 0 | centrés |
| Hôtel des ventes du royaume | boutique | Deepslate | rouge | 3 | 5 | à droite |
| Récoltes | grille | mc-rs | vert | 4 | 1 | à droite |
| Coffre commun | grille | Deepslate | bleu | 3 | 9 | à gauche |
| Raccourcis | grille | sombre à accent | cyan | 2 | 3 | centrés |
| Collection | grille | mc-rs | violet | 6 | 0 | à droite |
| Confirmation | modale | sombre à accent | rouge | 3 | 2 | répartis |
| Quitter la guilde | modale | Deepslate | vert | 4 | 3 | répartis |
| Avertissement | modale | mc-rs | or | 3 | 1 | centrés |
| Achat | modale | sombre à accent | vert marché | 5 | 3 | centrés |
| Joueurs | liste | mc-rs | or | 6 | 1 | centrés |
| Quêtes | liste | Deepslate | vert | 5 | 3 | répartis |
| Historique | liste | sombre à accent | violet vif | 3 | 5 | centrés |
| Profil | onglets | sombre à accent | rouge | 6 | 4 | à gauche |
| Atelier | onglets | mc-rs | cyan | 5 | 3 | répartis |
| Catalogue | onglets | Deepslate | orange | 4 | 9 | à gauche |
| Mode | onglets | sombre à accent | jaune | 2 | 2 | centrés |
| Garde-robe | onglets | mc-rs | rose | 6 | 5 | centrés |

Les réglages vivent dans `studio/src/model/interfaceExamples.ts` ; `npm test`
vérifie que chaque exemple donne un menu valide pour le schéma.

## Générateur de textures

« Générer une texture… » (section Couches de la colonne de gauche, menu
contextuel de la toile) dessine une couche à la taille voulue, avec un aperçu
et les paramètres propres à la famille (rayon, bordure, accent, état, ombre,
progression) :

| Famille | Styles |
|---|---|
| Deepslate | panneau biseauté, bouton, cellule de slot, voile de modale, aplat |
| mc-rs | panneau sombre et arrondi, bordure seule, bouton plat à trois états, bouton en relief, bande or ou orange, case creusée, grille de chargement |
| Sombre à accent | fenêtre plate, case creusée, onglet, bouton plat, bouton fermer, store rayé, ligne de liste, cartouche de valeur, barre de progression |

Tous les styles acceptent une **icône** pixel centrée dans le corps du
bouton (croix, retour, sac, bourse, aide, chevrons, chiffres 1 à 9), claire
ou foncée selon le fond, ou dans la couleur choisie.

Un panneau peut dessiner les **cellules des slots** d’une zone de la grille,
dans le style de son choix. La texture ne dépend que de ses paramètres : le
studio la recuit à l’identique, octet pour octet. Clés et valeurs de chaque
style : [`format.md`](format.md#couches-layers).

![Le générateur de textures : style, taille, couleur et cellules de slots d’un panneau biseauté, avec son aperçu](../site/assets/screens/texture-generator.png)

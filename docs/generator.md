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

Défauts connus, reproduits tels quels par les exemples en attendant une
décision : les boutons d’une case n’ont pas de libellé, et le fond de la
famille mc-rs est translucide.

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

Un panneau peut dessiner les **cellules des slots** d’une zone de la grille,
dans le style de son choix. La texture ne dépend que de ses paramètres : le
studio la recuit à l’identique, octet pour octet. Clés et valeurs de chaque
style : [`format.md`](format.md#couches-layers).

![Le générateur de textures : style, taille, couleur et cellules de slots d’un panneau biseauté, avec son aperçu](../site/assets/screens/texture-generator.png)

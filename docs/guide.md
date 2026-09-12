# Guide de prise en main

Un premier menu Java, puis un premier formulaire Bedrock, de la création à
l’ouverture en jeu. Les détails sont dans les autres documents : écrans
([`screens.md`](screens.md)), format ([`format.md`](format.md)), Bedrock
([`bedrock.md`](bedrock.md)).

## 1. Installer et lancer le studio

Prérequis et variantes : [README](../README.md#installation). En bref :

```sh
git clone https://github.com/pedrokarim/menu-forge.git
cd menu-forge/studio
npm install
npm run tauri:dev     # appli de bureau ; npm run dev pour le navigateur
```

Au premier lancement, le studio propose un espace de travail : le dossier où
vivent les menus, les textures et les images.

## 2. Un premier menu Java

1. **Créer** : « Nouveau menu » (barre d’outils de l’éditeur ou accueil), puis
   un gabarit, « Vierge » ou « Générer une interface… ».
2. **Dessiner** : couches (générées, importées ou tirées d’une bibliothèque),
   textes, zones de slots (outil `S`) ; l’inspecteur règle chaque élément.
3. **Rendre cliquable** : dans l’inspecteur d’un slot, les actions au clic
   (ouvrir, retour, état, page, son, commande) et les conditions.
4. **Essayer** (`E`) : un clic sur un slot exécute ses actions comme en jeu ;
   le document ne change pas.
5. **Enregistrer** (`Ctrl+S`), puis **Exporter** (`Ctrl+E`) : menus et
   textures partent dans le dossier réglé dans **Paramètres › Export vers le
   plugin**.
6. **En jeu**, sur un serveur Paper avec le plugin MenuForge : copier `menus/`
   et `textures/` dans `plugins/MenuForge/workspace/`, `/menuforge reload`,
   puis `/menuforge open <id>`. Le pack de polices généré va dans le resource
   pack du serveur ([`../lib/README.md`](../lib/README.md)).

## 3. Un premier formulaire Bedrock

Un formulaire Bedrock est le formulaire à boutons du client Bedrock, affiché
dans une disposition du pack `mcrs_ui` du serveur mc-rs. Il n’a pas de rendu
Java : seul l’export Bedrock l’emporte.

### 3.1 Créer

« Nouveau menu », section **Formulaire Bedrock** : choisir une disposition,
donner un nom (l’identifiant suit), puis « Créer ». Le formulaire est
enregistré et s’ouvre dans son éditeur, avec quelques boutons de départ.

### 3.2 Choisir une disposition

La liste « Disposition », en haut de la colonne de gauche, change de
disposition à tout moment ; l’aperçu suit.

| Disposition | Clé | Pour |
|---|---|---|
| Grille | `grid` | grandes cases, trois par ligne : menu d’actions, hub |
| Grille d’images | `image_grid` | grandes vignettes avec titre superposé : carte, arène |
| Image carrée | `square_image` | une grande image centrée, description en bas : annonce |
| Boutique | `store` | onglets de catégories et grille de produits |
| Boutons à gauche | `left_button` | liste à gauche, description à droite : réglages, navigation |
| Boutons en bas | `bottom_button` | bannière et description en haut, boutons en bas : mode de jeu |
| Message du jour | `motd` | colonne étroite, texte défilant, boutons verts côte à côte |
| Récap | `wrapped` | lien en haut, visuels qui défilent, boutons violets en bas |

Le titre et le contenu acceptent les codes `§` et les variables
(`{viewer.name}`…).

### 3.3 Boutons

« Ajouter », dans l’en-tête de la liste, pose un bouton ou, selon la
disposition, une bannière ou un bouton spécial. Glisser une ligne la déplace ;
un clic droit duplique, monte, descend ou supprime. L’inspecteur de droite
édite le bouton sélectionné : identifiant, texte, sous-titre (envoyé après une
tabulation) et rôle. L’index d’un clic est le **rang parmi les boutons
envoyés**.

### 3.4 Icônes

Bloc « Icône » de l’inspecteur, trois origines :

- **Espace** : une texture de l’espace de travail (vignettes filtrables), un
  PNG importé, une icône de 32 × 32 dessinée dans l’éditeur de pixels
  (« Dessiner ») ou une texture d’un pack branché (« Bibliothèque ») ; elle est
  copiée dans le pack Menu Forge à l’export ;
- **Vanilla** : une texture du jeu ou d’un pack du serveur, citée par son
  chemin sans extension (`textures/items/diamond`) ; elle n’est jamais copiée,
  le client la trouve ;
- **Adresse** : une image en `https://…`.

### 3.5 Actions et conditions

- **Actions au clic** : `open` (un menu ou un formulaire ; la pile garde le
  chemin), `back`, `close`, `setState`, `sound`, `command` (en joueur ou en
  console, variables remplacées), `custom`. Sauf fermeture, le serveur renvoie
  le formulaire après le clic.
- **Envoyé si** (`visibleWhen`) : une condition sur l’état ou sur un drapeau
  du joueur (`viewer.op`…) ; fausse, le bouton n’est pas envoyé.

« Essayer » (`E`) rejoue les clics sur l’aperçu, comme le serveur ; les
drapeaux et le pseudo de l’aperçu se règlent dans la colonne de droite.

L’aperçu se zoome comme les toiles des autres éditeurs : `+` et `-`,
`Maj+0` (taille réelle), `Maj+1` (ajuster à la zone), `Maj+2` (zoomer sur le
bouton sélectionné), ou le sélecteur de la barre de l’aperçu. Les deux
colonnes se règlent à la souris par leur bord (double-clic pour rétablir) ;
la largeur choisie est gardée d’une session à l’autre.

### 3.6 Exporter

1. **Paramètres › Export pour Bedrock** : le dossier du serveur Bedrock ; pour
   mc-rs, `menu_forge/export`.
2. Dans l’éditeur, **Bedrock** (barre d’outils) : tous les menus de l’espace
   sont exportés, le pack de ressources dans `pack/` et le descripteur
   d’exécution dans `runtime.json`. Un export suivant ne retire que ce que le
   précédent avait écrit.

Le client a besoin de deux packs, fournis par le serveur : celui de Menu Forge
(menus coffre et icônes) et `mcrs_ui` (dispositions des formulaires).

### 3.7 Lancer sur mc-rs

Sur le serveur, en jeu :

| Commande | Effet |
|---|---|
| `/mf reload` | relit l’export après un nouvel export, sans redémarrer |
| `/mf list` | liste les menus et formulaires exportés |
| `/mf open <id>` | ouvre un menu ou un formulaire au joueur |

Pour un formulaire, un changement de textes, d’actions ou de conditions passe
par `/mf reload` seul ; un nouveau visuel (menu coffre, nouvelle icône)
demande en plus une reconnexion du client, qui recharge le pack.

## 4. Pour aller plus loin

- [`screens.md`](screens.md) : tous les écrans et leurs raccourcis ;
- [`format.md`](format.md) : le format des menus, dont la clé `form` ;
- [`bedrock.md`](bedrock.md) : le contrat entre l’exporteur et le serveur ;
- [`rendering.md`](rendering.md) : le rendu Java, glyphe par glyphe.

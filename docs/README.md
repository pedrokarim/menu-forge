# Documentation de Menu Forge

Menu Forge dessine des inventaires Minecraft custom et les ouvre en jeu, sur
Java (plugin Paper) comme sur Bedrock (serveur mc-rs). Cette page est le
sommaire de la documentation : chaque sujet a sa page, et chaque information
n’est écrite qu’à un seul endroit ; les autres pages y renvoient.

La même documentation se lit sur le site du projet :
<https://pedrokarim.github.io/menu-forge/docs/>.

## Commencer

| Page | Pour |
|---|---|
| [Guide de prise en main](guide.md) | installer le studio, faire un premier menu Java et un premier formulaire Bedrock, jusqu’en jeu |

## Utiliser le studio

| Page | Pour |
|---|---|
| [Écrans du studio](screens.md) | l’accueil, les éditeurs, les bibliothèques, les paramètres, la fenêtre, les colonnes et les notifications |
| [Raccourcis clavier](shortcuts.md) | tous les raccourcis, groupés comme dans l’aide-mémoire du studio |
| [Générateur d’interfaces et de textures](generator.md) | les cinq types d’interfaces, les trois familles de styles, la galerie de 22 exemples, les textures générées |
| [Génération par IA](ai.md) | les onze fournisseurs, les clés, ce qui est envoyé, les contraintes, les tâches de fond |
| [Éditeur de pixels](pixels.md) | le format `*.pixel.json`, les outils, les calques et l’export en PNG |
| [Mode libre : les assets](assets.md) | le format `*.asset.json` et l’export en glyphe |

## Formats et rendu

| Page | Pour |
|---|---|
| [Format des menus](format.md) | le format `*.menu.json` : couches, textes, slots, état, conditions, actions, gabarits, composants, formulaires Bedrock |
| [Visualiseur de shaders](shaders.md) | exécuter et modifier les shaders « core » d’un pack dans le studio : scènes d’essai, includes, limites |
| [Modèle de rendu Java](rendering.md) | comment une couche devient un glyphe : coordonnées, `ascent`, avance, police pixel, pièges connus |
| [`menu.schema.json`](menu.schema.json), [`asset.schema.json`](asset.schema.json) | les schémas JSON des menus et des assets, pour valider un fichier écrit à la main ou généré |

## Du studio au serveur

| Page | Pour |
|---|---|
| [Exporter et installer](export.md) | les trois exports du studio (plugin, pack ZIP, Bedrock), ce qu’ils écrivent et où |
| [Lib Java et plugin Paper](../lib/README.md) | installer le plugin MenuForge, ses commandes, sa configuration et son API |
| [Menu Forge sur Bedrock](bedrock.md) | le contrat entre l’exporteur et un serveur Bedrock : pack, `runtime.json`, formulaires, exécution |

## Le projet

| Page | Pour |
|---|---|
| [Feuille de route](roadmap.md) | ce qui est fait, ce qui est vérifié, ce qui vient ensuite |
| [Développer le studio](../studio/README.md) | lancer, construire, API locale, tests unitaires et de bout en bout |
| [Rich Presence Discord](discord.md) | la présence sur le profil Discord, facultative |
| [Site du projet](../site/README.md) | le site GitHub Pages, ses pages de documentation et ses captures |

Règles de contribution (langue, typographie, assets) : [`AGENTS.md`](../AGENTS.md).

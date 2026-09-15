# Exporter et installer

Du studio au serveur : les trois exports du studio, ce qu’ils écrivent et
où, puis ce qu’il reste à faire côté serveur, sur Java et sur Bedrock. Le pas
à pas d’un premier export est dans le [guide](guide.md).

## Avant le premier export

Les dossiers cibles se règlent dans **Paramètres** (`Ctrl+5`) ; tant qu’un
dossier n’est pas réglé, l’export correspondant est refusé avec un message.

| Section | Réglage | Rôle |
|---|---|---|
| Export vers le plugin | Dossier du serveur Java (ressources du plugin) | Ressources du plugin qui ouvre les menus, quel que soit le serveur Java (souvent `src/main/resources`) : l’export écrit dans son sous-dossier `menuforge/` |
| Export vers le plugin | Espace de noms | Espace de noms des polices et textures du pack ZIP (`menuforge` par défaut) |
| Export vers le plugin | `pack_format` | Écrit dans `pack.mcmeta` : 32 pour 1.20.5 et 1.20.6, 34 pour 1.21, 46 pour 1.21.4 (par défaut) |
| Export pour Bedrock | Dossier d’export Bedrock | Dossier du serveur Bedrock qui reçoit le pack et `runtime.json` ; pour mc-rs, `menu_forge/export` |

## Les trois exports

Les trois se lancent depuis l’éditeur de menus : boutons de la barre
d’outils, menu contextuel de la toile ou raccourcis. Le menu ouvert est
d’abord enregistré s’il a changé, puis **tous** les menus de l’espace sont
exportés, gabarits et composants appliqués ; les gabarits et les composants
eux-mêmes ne le sont pas.

| Export | Lancer | Ce qui est écrit | Où |
|---|---|---|---|
| Vers le plugin | **Exporter**, `Ctrl+E` | Menus coffre résolus (sans `extends`, `template` ni métadonnées `generator`) et PNG qu’ils utilisent | `<dossier>/menuforge/menus/` et `textures/`, manifeste `.menu-forge-export.json` |
| Pack ZIP de test | **Pack ZIP**, `Ctrl+Maj+E` | Polices et textures générées, `pack.mcmeta` | `<espace>/exports/<namespace>-pack.zip` |
| Pour Bedrock | **Bedrock** | Pack de ressources Bedrock et descripteur d’exécution `runtime.json` | `<dossier Bedrock>/pack/` et `runtime.json`, manifeste `.menu-forge-bedrock-export.json` |

- Les **formulaires Bedrock** (clé `form`) n’ont pas de rendu Java : seul
  l’export Bedrock les emporte.
- Les deux exports vers un dossier tiennent un **manifeste** : un export
  suivant ne supprime que les fichiers écrits par le précédent et absents du
  nouveau. Un fichier déposé à la main n’est jamais touché.

![L’éditeur après un export vers le plugin, et le menu contextuel de la toile avec ses exports](../site/assets/screens/export.png)

## Sur un serveur Paper (Java)

Le plugin **MenuForge** lit les menus exportés, génère les polices du resource
pack et ouvre les menus. Il vise Paper 1.20.6 et plus (Java 21).

1. Construire le plugin (`cd lib`, puis `./gradlew build`) et déposer
   `menu-forge-paper/build/libs/MenuForge-<version>.jar` dans `plugins/`.
2. Copier `menus/` et `textures/` de `<dossier>/menuforge/` dans
   `plugins/MenuForge/workspace/`. Un plugin qui embarque ses propres menus
   les déclare plutôt avec `addWorkspace`, comme Enderium.
3. `/menuforge reload` relit les menus et régénère le pack de polices dans
   `plugins/MenuForge/pack/` (et `pack.zip`) : **l’intégrer au resource pack
   du serveur**. MenuForge ne l’envoie pas lui-même aux joueurs.
4. `/menuforge open <id> [joueur]` ouvre un menu.

Le visuel « cases seules » du coffre (`generic_54.png` sans cadre) n’est pas
fourni : c’est au pack du serveur de le porter
([`rendering.md`](rendering.md#1-le-principe)). Commandes, configuration et
API du plugin : [Lib Java et plugin Paper](../lib/README.md).

## Sur un serveur Bedrock (mc-rs)

Le serveur a besoin de deux packs : celui de Menu Forge (menus coffre et
icônes des formulaires), écrit par l’export, et `mcrs_ui` (dispositions des
formulaires), livré par mc-rs. Sur le serveur :

| Commande | Effet |
|---|---|
| `/mf reload` | Relit l’export après un nouvel export, sans redémarrer |
| `/mf list` | Liste les menus et formulaires exportés |
| `/mf open <id>` | Ouvre un menu ou un formulaire au joueur |

Un changement de textes, d’actions ou de conditions passe par `/mf reload`
seul ; un nouveau visuel (menu coffre, nouvelle icône) demande en plus que le
joueur se reconnecte, pour recevoir le pack. Contrat complet entre
l’exporteur et le serveur : [Menu Forge sur Bedrock](bedrock.md).

## Le pack ZIP de test

Il sert à essayer les polices sans serveur : glissé dans les resource packs
d’un client, il affiche les menus dans leur titre. Il ne contient pas le
`generic_54.png` « cases seules » : dans un coffre vanilla, le cadre reste
visible sous les couches.

## Comment l’export est produit

La génération est écrite en TypeScript (`studio/src/export/`), à côté de la
composition du titre et de la résolution des gabarits : l’export produit
exactement ce que montre l’éditeur. Les PNG sont lus et écrits sans canvas,
pour que les pixels semi-transparents restent exacts. Une fixture partagée
avec la lib (`lib/menu-forge-core/src/test/resources/parity/`) vérifie des deux
côtés les mêmes polices octet pour octet, les mêmes textures pixel pour pixel
et les mêmes titres (`npm test`, `./gradlew build`).

Le backend Rust ne fait qu’écrire, et seulement dans ces dossiers : routes
`POST /api/export/plugin`, `PUT /api/exports/<nom>.zip` et
`POST /api/export/bedrock` ([API locale](../studio/README.md#api-locale)).
L’export Bedrock est **déterministe** et incrémente seul la version de son
pack ([`bedrock.md`](bedrock.md#21-manifest-et-cache-du-client)).

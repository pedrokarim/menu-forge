# menu-forge – lib Java

Côté serveur de menu-forge : lecture du format `*.menu.json`, génération des
polices du resource pack et ouverture des menus en jeu. La source de vérité
reste [`../docs/format.md`](../docs/format.md) (le format) et
[`../docs/rendering.md`](../docs/rendering.md) (le modèle de rendu).

## Modules

| Module | Java | Rôle |
|---|---|---|
| `menu-forge-core` | 17 | Noyau autonome, **sans Bukkit** (seul Gson) : modèle, parseur, gabarits, conditions, mesure des images, composition du titre, génération du pack |
| `menu-forge-paper` | 21 | Plugin Paper autonome **MenuForge** (Paper 1.20.6 minimum, `api-version` 1.20 ; le modèle d’item de 1.21.4 est utilisé par réflexion s’il existe) : chargement de l’espace de travail, sessions, clics, actions, commandes, API publique |

Paquetage racine : `dev.menuforge`.

### Pourquoi un plugin séparé ?

Un plugin qui embarque ses dépendances en relocalisant `net.kyori` (c’est le
cas d’Enderium) casse les appels Adventure natifs de Paper
(`Bukkit.createInventory(holder, taille, Component)`,
`GsonComponentSerializer`…). MenuForge utilise l’Adventure de Paper, sans
relocalisation : le serveur consommateur dépend de MenuForge au lieu de
l’embarquer.

## Construire

```bash
JAVA_HOME="/c/Program Files/Java/jdk-21" ./gradlew build
```

- `menu-forge-core/build/libs/menu-forge-core-<version>.jar` : le noyau seul ;
- `menu-forge-paper/build/libs/MenuForge-<version>.jar` : le plugin, noyau
  inclus (Gson et Adventure sont fournis par Paper).

### Tests

`./gradlew build` lance :

- les tests du noyau (parseur, gabarits, conditions, mesure, composition du
  titre, génération du pack) ;
- la **fixture de parité** partagée avec le studio
  (`menu-forge-core/src/test/resources/parity/`) : menus et textures dont la
  sortie attendue (polices, textures recadrées, titres) est vérifiée octet
  pour octet par `ParityFixtureTest`, et par `studio/tests/parity.test.ts`
  côté studio. Après un changement voulu de l’algorithme :
  `./gradlew :menu-forge-core:test --tests '*ParityFixtureTest' -PparityUpdate=true`,
  puis `npm test` dans `studio/` ;
- les tests du plugin sur un **serveur simulé** (MockBukkit bâti sur
  paper-api 1.20.6, la version minimale visée) : ouverture d’un menu et titre
  composé, clics verrouillés sauf dans les slots `input` (shift-clic, glisser,
  double-clic), `setState` qui reconstruit le coffre, pagination bornée, pile
  `open` / `back` / `close`, actions `custom`, drapeaux et variables du
  serveur, commandes et complétion, espaces de travail supplémentaires.

## Le noyau en bref

| Paquetage | Contenu |
|---|---|
| `model` | Records immuables du format : `MenuDefinition`, `Layer`, `TextElement`, `Slot`, `SlotArea`, `ItemSpec`, `Action`, `StateDefinition`, `Condition` |
| `parse` | `MenuParser` (erreurs avec le chemin de la clé fautive, par exemple `$.layers[1].x`), `MenuValidator` (cohérence d’un menu résolu) |
| `template` | `TemplateResolver` : héritage `extends`, remplacement par `id` à la position du gabarit, détection de cycle |
| `state` | `ConditionContext`, `StateSnapshot` (drapeaux et variables de page), `Pagination` |
| `image` | `ImageMeasurer` (boîte des pixels d’alpha non nul), `TextureLibrary` |
| `render` | `TitleComposer` (jetons du titre, même algorithme que le studio), `TitleRenderer` (composant JSON), `SpaceFont`, `FontLayout`, `CompiledMenu` |
| `pack` | `PackGenerator` (fichiers virtuels `Map<String, byte[]>`), `PackWriter` (dossier ou zip) |
| `calibration` | Menu de calibration généré par code |

Utilisation autonome (par exemple depuis le pipeline de pack d’un serveur) :

```java
MenuParser parser = new MenuParser();
Map<String, MenuDefinition> all = ...; // tous les fichiers lus avec parser.parse(path)
TemplateResolver resolver = new TemplateResolver(all::get);
MenuDefinition badges = resolver.resolve(all.get("badges"));
MenuValidator.validate(badges);

TextureLibrary textures = new TextureLibrary(new DirectoryTextureSource(texturesDir));
GeneratedPack pack = new PackGenerator("menuforge").generate(List.of(badges), textures);
pack.files().forEach((path, bytes) -> ...); // ou PackWriter.writeDirectory(pack, dossier)

CompiledMenu compiled = CompiledMenu.compile(badges, textures);
StateSnapshot snapshot = StateSnapshot.of(badges.state(), Map.of("page", 2), Map.of("page", 5));
String titleJson = compiled.titleJson(new TitleRenderer("menuforge"),
    snapshot.context(Set.of()), snapshot.asResolver());
```

## Le plugin MenuForge

### Installation

1. Déposer `MenuForge-<version>.jar` dans `plugins/`.
2. Déposer les menus exportés par le studio dans
   `plugins/MenuForge/workspace/menus/` (sous-dossiers acceptés) et leurs
   images dans `plugins/MenuForge/workspace/textures/`.
3. Au démarrage (et à chaque `/menuforge reload`), le pack de polices est
   régénéré dans `plugins/MenuForge/pack/` (et `plugins/MenuForge/pack.zip`).
   **Le serveur doit intégrer ces fichiers à son propre resource pack** : ils
   ne sont pas envoyés aux joueurs par MenuForge.
4. Le visuel « cases seules » (`gui/container/generic_54.png` sans cadre) n’est
   pas fourni : c’est au pack du serveur de le porter (voir
   [`rendering.md`](../docs/rendering.md) § 1 et § 6).

Seuls `assets/<ns>/font/menus/` et `assets/<ns>/textures/menus/` sont vidés
avant chaque génération ; le reste du dossier `pack/` n’est pas touché.

### Commandes

Permission : `menuforge.admin` (op par défaut). Alias : `/mf`.

| Commande | Effet |
|---|---|
| `/menuforge open <menu> [joueur]` | Ouvre un menu |
| `/menuforge reload` | Relit la configuration, les menus et les textures, régénère le pack, ferme les menus ouverts ; affiche les erreurs |
| `/menuforge calibrate [joueur]` | Ouvre le menu de calibration |

Le menu de calibration (`menuforge_calibration`, 6 lignes) contient une seule
couche générée par code : règles graduées tous les 2 px sur les bords haut et
gauche, cadre théorique de la fenêtre, cellule théorique de chaque slot (coffre
en vert, inventaire du joueur en cyan) avec un point au coin de l’item, repère
du centre en `x = 88`. Des pierres occupent les quatre coins du coffre, et
trois textes testent l’alignement gauche (`x = 8`, `y = 6` : la position du
titre vanilla), droit et centré.

### Configuration (`config.yml`)

| Clé | Défaut | Rôle |
|---|---|---|
| `namespace` | `menuforge` | Espace de noms des polices et textures générées |
| `pack.format` | `46` | `pack_format` écrit dans `pack.mcmeta` (46 = 1.21.4) |
| `pack.zip` | `true` | Écrire aussi `pack.zip` |
| `invisible-item.material` | `PAPER` | Matériau des boutons invisibles |
| `invisible-item.item-model` | vide | Modèle d’item (`item_model`) des boutons invisibles |
| `invisible-item.custom-model-data` | `0` | `CustomModelData` utilisé si aucun modèle n’est donné |

### Comportement en jeu

- Chaque joueur a une **session** : une pile de menus (`open` empile, `back`
  dépile ou ferme), l’état du menu courant et sa pagination.
- Le titre est un composant JSON désérialisé par le `GsonComponentSerializer`
  de Paper. Minecraft ne sachant pas changer le titre d’un inventaire ouvert,
  tout changement d’état reconstruit le coffre et le rouvre.
- Tout clic est annulé, sauf dans les slots `input` actifs. Le shift-clic
  depuis l’inventaire du joueur est redirigé vers les slots `input`, le
  « ramasser tout » (double-clic) est bloqué, un glisser qui touche un autre
  slot du menu est refusé. Les items des slots `input` suivent les
  reconstructions et sont rendus au joueur quand il quitte le menu (ou jetés à
  ses pieds si son inventaire est plein).
- Les actions s’exécutent au tick suivant le clic ; plusieurs changements
  d’état dans un même clic ne reconstruisent le menu qu’une fois.
- `enabledWhen` faux : le slot est affiché mais ne réagit pas. `visibleWhen`
  faux : le slot est vide.

## Brancher un serveur : les SPI

Le serveur consommateur déclare `depend: [MenuForge]` (ou `softdepend`),
dépend de `menu-forge-paper` en `compileOnly`, puis récupère l’API :

```java
MenuForgeApi api = MenuForgeApi.get(); // Bukkit.getServicesManager().load(MenuForgeApi.class)
```

| SPI | Méthode | Rôle |
|---|---|---|
| `ListProvider` | `registerListProvider(nom, provider)` | Source de données des slots `list` : renvoie **toutes** les entrées (item + actions du format et/ou code Java) ; la lib pagine |
| `FlagProvider` | `registerFlagProvider(provider)` | Drapeaux `viewer.*` et custom (`null` = inconnu, absent = faux) |
| `PlaceholderResolver` | `registerPlaceholderResolver(resolver)` | Variables inconnues de la lib (`null` = inconnue, laissée telle quelle) |
| `ItemFactory` | `setItemFactory(factory)` | Items `ref` et item invisible ; `defaultItemFactory()` permet de déléguer |
| `CustomActionHandler` | `registerCustomAction(id, handler)` | Actions `custom`, par `id` |

Exemple :

```java
api.registerListProvider("badges", request -> badgeService.badgesOf(request.viewer()).stream()
    .filter(badge -> badge.tab().equals(request.state().get("tab")))
    .map(badge -> ListEntry.of(badge.icon(), context -> badgeService.showDetails(context.player(), badge)))
    .toList());

api.registerFlagProvider((viewer, flag) ->
    "viewer.isStaff".equals(flag) ? viewer.hasPermission("monserveur.staff") : null);

api.registerPlaceholderResolver((viewer, name) ->
    name.startsWith("papi.") ? PlaceholderAPI.setPlaceholders(viewer, "%" + name.substring(5) + "%") : null);

api.registerCustomAction("monserveur:reward", (context, args) ->
    rewards.give(context.player(), (String) args.get("reward")));

api.open(player, "badges", Map.of("tab", "discovery"));
```

Variables résolues par la lib : `{viewer}` et `{viewer.name}`, `{viewer.uuid}`,
`{state.<nom>}`, et pour chaque état `page` nommé `p` : `{p.number}`,
`{p.count}` (drapeaux `p.hasPrev` / `p.hasNext`).

Pour un pipeline de pack existant (celui d’Enderium, par exemple), les fichiers
générés sont disponibles en mémoire via `api.generatedPack().files()`, chemins
relatifs à la racine du pack.

### Menus embarqués par un plugin

| Méthode | Rôle |
|---|---|
| `addWorkspace(root)` / `removeWorkspace(root)` | Espace de travail supplémentaire (`root/menus/**`, `root/textures/**`), lu à chaque rechargement après celui de MenuForge : c’est ainsi qu’un plugin fournit ses menus. Un id déjà vu est refusé ; une texture est prise dans le premier espace qui la possède. |
| `registerReloadListener(listener)` | Appelé après chaque rechargement avec le pack régénéré (pour reconstruire le resource pack du serveur). |
| `unregisterFlagProvider`, `unregisterPlaceholderResolver`, `unregisterReloadListener`, `unregisterCustomAction` | Retrait des SPI à la désactivation du plugin consommateur. |

### Consommer la lib depuis un autre build

Le plugin consommateur dépend de `dev.menuforge:menu-forge-paper` en
`compileOnly` et déclare `softdepend: [MenuForge]` : MenuForge reste un plugin
à part, à ne jamais embarquer ni relocaliser.

- **Build composite** (conseillé en développement) :
  `includeBuild("../menu-forge/lib")` dans son `settings.gradle.kts` ; Gradle
  substitue la dépendance par le projet, compilé depuis les sources.
- **Maven local** : `./gradlew publishToMavenLocal` ici, puis `mavenLocal()`
  côté consommateur.

Premier consommateur : enderium-core (voir son `.agent/menu-forge.md`).

## Calibration en jeu

Vérifié dans un client le 2026-09-10 (Paper 1.20.6, détails dans
[`../docs/rendering.md`](../docs/rendering.md)) :

- la formule `ascent = 13 − y`, les avances et le recadrage : placement
  horizontal et vertical exact au pixel ;
- les largeurs des caractères testés et les alignements gauche, centre et
  droite ;
- l’ordre de rendu : les items passent au-dessus des couches du titre.

Reste à vérifier :

- la table d’avance complète (`CharWidths`) et la grille d’`ascii.png` hors
  ASCII (`AsciiFont`, lignes 0–1 et 8–15, reprises de mémoire) ;
- le complément transparent en bas des images quand `ascent > hauteur`, et
  les très grands `ascent` négatifs ;
- l’ordre de rendu titre / items en 1.21.x.

Les textes au-dessus de `y = 5` sont refusés (`ascent > 8`, que Minecraft
rejette pour une police de hauteur 8). Le menu `/menuforge calibrate` sert à
valider ces points.

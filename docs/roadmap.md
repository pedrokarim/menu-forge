# Feuille de route

État vivant du projet : à mettre à jour après chaque étape.

## Fait (2026-09-10)

- **Modèle de rendu** mesuré sur un pack de référence :
  [`rendering.md`](rendering.md) (coordonnées, formule de l’`ascent`, règle
  d’avance, pixel témoin).
- **Format v1** : [`format.md`](format.md) (couches, textes, slots, état,
  conditions, actions, gabarits).
- **Studio** (`studio/`) :
  - toile au pixel près, fond « cases seules » ou coffre vanilla, zoom ;
  - couches générées (panneau, bouton, cellule, voile, aplat) ou importées
    (PNG), déplaçables à la souris et aux flèches, réordonnables ;
  - textes dynamiques avec variables et alignement ;
  - zones de slots dessinées sur la grille (outil `S`), types bouton, liste,
    dépôt, décoration ; actions au clic ;
  - conditions d’affichage et d’activation, variables d’état, aperçu d’un état ;
  - **titre composé** affiché en direct, avec le même algorithme que la lib ;
  - 4 gabarits (coffre classique, modale, liste paginée, barre d’onglets) et
    héritage (`extends`) ;
  - annuler / rétablir, enregistrement dans l’espace de travail via une API
    locale qui refuse toute écriture hors du dossier.
- **Lib Java** (`lib/`, détails dans [`../lib/README.md`](../lib/README.md)) :
  - `menu-forge-core` (Java 17, Gson seulement) : parseur avec chemin de la
    clé fautive, gabarits, conditions, mesure des PNG, composition du titre,
    génération du pack (une police par menu, polices de texte par `ascent`) ;
  - `menu-forge-paper` : plugin Paper autonome `MenuForge` (1.21.4 minimum),
    API + SPI (`ListProvider`, `FlagProvider`, `PlaceholderResolver`,
    `ItemFactory`, `CustomActionHandler`), sessions avec pile pour `back`,
    clics verrouillés sauf slots `input`, commandes `/menuforge open`,
    `reload`, `calibrate`.

## Vérifié

- Studio : typecheck, build et lint sans avertissement.
- Lib : `./gradlew build` réussi, 32 tests du noyau, 0 échec.
- API locale : lecture, écriture de menu et de texture, refus d’un non-PNG et
  d’un chemin qui sort de l’espace de travail (tests `curl`).
- Interface : chargement d’un menu, rendu des couches, textes, zones et titre
  composé (capture Edge headless).

## Pas encore vérifié

- Les interactions à la souris dans un vrai navigateur : glisser une couche,
  dessiner une zone, générateur, création depuis un gabarit.
- **Tout le rendu en jeu** : formule de l’`ascent`, avance, ordre de rendu
  titre / items, table des largeurs ASCII.
- Le plugin `MenuForge` n’a jamais tourné sur un serveur et n’a pas de tests
  automatisés.
- La grille des caractères accentués d’`ascii.png` (lignes 0–1 et 8–15) est
  reprise de mémoire ; une erreur n’affecterait que ces caractères.
- `pack_format` 46 par défaut, à ajuster selon la version du serveur.

## Prochaines étapes

1. **Calibration en jeu** : ouvrir le menu de calibration de la lib et
   confirmer (ou corriger) le modèle de rendu.
2. **Adaptateur Enderium** (dans enderium-core) : ClickActions, requirements,
   placeholders, fusion des polices générées dans `ResourcePack`.
3. **Premier vrai menu** : recréer `/profile` avec menu-forge, avec des
   textures générées à la place des assets d’un pack de référence.
4. **Studio** :
   - police pixel fidèle pour l’aperçu des textes ;
   - éditeur visuel des états et des actions (sans passer par le JSON) ;
   - export d’un pack ZIP pour tester sans serveur ;
   - copier / coller, multi-sélection, repères.
5. **Décider** du sort de `generic_54.png` (effet global sur tous les coffres).

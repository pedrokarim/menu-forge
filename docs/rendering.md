# Modèle de rendu

Comment une image dessinée dans le studio finit à l’écran du joueur. Tout ce qui
suit a été **mesuré** sur un pack de référence étudié en local (voir « Sources ») ; les points
encore à confirmer en jeu sont marqués **[à calibrer]**.

## 1. Le principe

Un menu est un **coffre vanilla** (`generic_9xN`). Deux hacks de resource pack :

1. `gui/container/generic_54.png` est remplacé par une image « cases seules » :
   le cadre du coffre disparaît, seules les cellules des slots restent.
2. Tout le visuel est dessiné dans le **titre** du coffre, avec des caractères
   d’une police custom dont chaque caractère est une image (provider `bitmap`).

Les slots restent de vrais slots : cliquables, capables d’afficher un item.
Un bouton, c’est donc une image dans le titre **plus** un slot (souvent avec un
item invisible) posé au même endroit.

## 2. Système de coordonnées

Le studio et le format travaillent en **coordonnées fenêtre**, en pixels GUI :

- origine `(0, 0)` = coin haut-gauche de la fenêtre du coffre vanilla ;
- largeur de la fenêtre : **176 px** ;
- hauteur : `114 + 18 × lignes` (222 px pour 6 lignes).

Grille des slots (coffre, `col` de 0 à 8, `row` de 0 à lignes − 1) :

| Élément | x | y |
|---|---|---|
| Item du slot (16×16) | `8 + 18 × col` | `18 + 18 × row` |
| Cellule (18×18) | `7 + 18 × col` | `17 + 18 × row` |
| Inventaire joueur, ligne `r` (0 à 2) | `8 + 18 × col` | `31 + 18 × lignes + 18 × r` (139 pour 6 lignes) |
| Barre d’action | `8 + 18 × col` | `89 + 18 × lignes` (197 pour 6 lignes) |

(Valeurs de `ChestMenu` : `103 + 18 × (lignes − 4)` et `161 + 18 × (lignes − 4)`.)

Le titre est dessiné en `(8, 6)`.

La fenêtre est centrée à l’écran : `leftPos = (largeurGUI − 176) / 2` et
`topPos = (hauteurGUI − hauteurFenêtre) / 2` (divisions entières). Attention :
Minecraft arrondit la taille de l’écran en pixels GUI **au supérieur**
(1351 px / échelle 4 = 337,75 → **338**). À retenir pour mesurer une capture :
une origine calculée avec l’arrondi inférieur donne un faux décalage d’1 px.

## 3. D’une image à un glyphe

### Vertical : `ascent`

Pour un glyphe bitmap dont l’image fait `height` px de haut (échelle 1), le haut
de l’image est dessiné à :

```
yHaut = titleY + 7 − ascent        (titleY = 6)
```

donc, pour poser le haut d’une image à la coordonnée fenêtre `y` :

```
ascent = 13 − y
```

Vérification sur le pack de référence : leurs toiles 256×256 ont `ascent: 19`, donc
`yHaut = −6`. Leur barre de navigation occupe les lignes 21 à 40 de la toile,
soit y = 15 à 34 dans la fenêtre : exactement la ligne 0 des slots (17 à 35).
Leur panneau commence ligne 39 de la toile, soit y = 33 : juste sous la ligne 0.

**Validé en jeu** (2026-09-10, Paper 1.20.6, client 2560×1351, interface ×4,
menu `/menuforge calibrate`) : le cadre de calibration tombe en (0, 0)–(176,
222), les cellules du coffre en (7, 17)–(169, 125), celles de l’inventaire à
leur place, au pixel près. Référence indépendante : le gris des cases dessiné
par le client (`generic_54.png`) commence exactement 1 px sous le trait de
cellule tracé par le titre.

Contrainte de Minecraft : `ascent ≤ height`. **[à calibrer]** le cas des très
grandes valeurs négatives.

### Horizontal : l’avance

Après un caractère bitmap, le curseur avance de :

```
avance = (dernière colonne non transparente) + 1 + 1
```

**Ce n’est pas la largeur du PNG.** Minecraft scanne l’image et s’arrête à la
dernière colonne contenant un pixel d’alpha non nul. Une toile de 256 px dont le
dessin s’arrête en colonne 175 avance de 177.

Conséquence, le piège n° 1 : si deux couches n’ont pas la même dernière colonne,
un recul fixe ne ramène pas le curseur au même point et tout ce qui suit est
décalé.

- **Pack de référence** : chaque couche est une toile 256×256 avec un **pixel témoin**
  en colonne 175 (souvent en (175, 143), caché sous le cadre). Toutes les couches
  avancent donc de 177, et un caractère d’espace d’avance −177 les sépare.
- **Menu Forge** : chaque couche est **recadrée** sur son contenu, et la lib
  calcule l’avance réelle depuis les pixels au moment de générer la police.
  Plus léger dans le pack, et aucun pixel témoin à cacher.

### Composer un titre

Pour chaque couche visible, dans l’ordre (la dernière est au-dessus) :

```
[espace : x − curseur] [glyphe de la couche] (curseur += avance)
```

puis on revient à l’origine. Les espaces sont des caractères d’un provider
`space` générés à la demande (puissances de 2, positives et négatives), dans la
même police que les couches.

Le titre commence par un recul de −8 pour ramener le curseur de `x = 8` (position
du titre) à `x = 0` (bord de la fenêtre).

## 4. Une police par menu

Chaque menu a sa police : `assets/<namespace>/font/menus/<id>.json`. Avantages :

- les codepoints (`U+E000`, `U+E001`…) sont réutilisés d’un menu à l’autre
  sans collision ;
- les couches partagées (barre de navigation, textes) sont incluses par un
  provider `{"type": "reference", "id": "…"}`.

Le titre est un composant JSON avec `"font": "<namespace>:menus/<id>"`. Il ne
peut **pas** passer par une chaîne legacy (`§`), qui ne porte pas de police.

## 5. Texte dynamique

Pour écrire « 3/46 » à une hauteur donnée, on génère une copie de la police
ASCII vanilla avec l’`ascent` voulu (`minecraft:font/ascii.png`, `height: 8`),
une police par hauteur utilisée. C’est ce que fait le pack de référence (`ascent: -11`,
`-64`…).

Pour centrer ou aligner à droite, la lib a besoin de la largeur de chaque
caractère : table des avances de la police vanilla (la plupart des caractères
font 5 px + 1).

**Validé en jeu** pour `C a l i b r t o n x 1 6 8` : « Calibration » démarre à
x = 8, « x168 » aligné à droite sur 168 finit à 167, « 88 » centré sur 88
occupe 82 à 93. La **table complète** est aussi validée hors jeu : les avances
des 95 caractères ASCII imprimables, recalculées depuis le vrai `ascii.png`
(Minecraft 1.21.5) avec la règle du jeu (dernière colonne opaque + 1, puis + 1
d’espacement), sont identiques à celles du studio et de la lib. Les accents
courants (`é è à ç É`) avancent de 6, `€` de 7.

### Aperçu dans le studio

Le studio dessine les textes du jeu avec la **police du jeu** quand la
bibliothèque `vanilla` est branchée (lue dans le pack, jamais copiée dans le
dépôt). Sinon, il se sert de la **police pixel de Menu Forge**
(`studio/src/lib/pixelFontGlyphs.ts`) : des lettres dessinées pour le
projet, sous la licence MIT du dépôt, mais avec les **métriques** du jeu :

- ligne de 8 px, capitales sur les rangées 0 à 6, jambages sur la rangée 7 ;
- avance de chaque caractère lue dans la table de `fontMetrics.ts` (la même que
  `CharWidths`) et, pour l’ASCII, dernière colonne encrée = avance − 2
  (1 px d’espacement, comme la règle du jeu) ;
- ombre, gras et codes « § » rendus par le même moteur que la police du jeu ;
- accents des capitales jusqu’à 3 px au-dessus de la ligne, comme dans le jeu.

Centrage, alignement à droite et titre composé tombent donc aux positions du
jeu : seul le dessin des lettres change. `npm test` vérifie ces métriques
(`tests/pixel-font.test.ts`). Caractères dessinés : l’ASCII imprimable, les
lettres accentuées du français (et les plus courantes des langues voisines),
« » ‘ ’ “ ” … – —, € £ § ° ± × ÷ ² ³ ¡ ¿, ß œ æ ø et leurs
capitales ; les espaces insécables avancent sans dessin. Un caractère absent
s’affiche comme dans le jeu, en cadre de 5 × 8 px (avance 6).

Un asset exporté **sans** pack vanilla garde dans son PNG les lettres de cette
police : branchez le pack pour exporter avec celles du jeu.

## 6. Pièges connus

- **Avance** : voir plus haut. Toujours la calculer depuis les pixels.
- **`generic_54.png` est global** : tous les coffres du serveur perdent leur
  cadre. À assumer, ou à contourner. **[à étudier]**
- **Ordre de rendu** : le titre est dessiné par-dessus le fond du coffre, mais
  **sous les items**. Validé en jeu (2026-09-10, Paper 1.20.6) : une pierre
  posée sur un aplat du titre reste entière, l’aplat ne se voit que dans les
  coins transparents de l’icône. Une couche peut donc peindre l’arrière-plan
  d’un bouton sans masquer l’item du slot. À revérifier si l’on vise un jour
  une version où le rendu des interfaces a changé (1.21.6 et suivantes).
- **Pack périmé** : toujours vérifier que le client a reçu la dernière version
  du pack avant d’analyser un décalage.

## Sources

- Pack de référence d’un serveur, étudié en local (hors dépôt)
  (polices `font/menus/**`, textures `textures/custom_ui/menus/**`).
- Mesures des avances : dernière colonne opaque = 175 sur 14 couches examinées
  (navigation, pages, filtres, fonds, modale).

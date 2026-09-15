# Visualiseur de shaders

L’écran **Shaders** (`Ctrl+4`) exécute les shaders « core » d’un resource pack
(`assets/minecraft/shaders/`) dans le studio, sans lancer Minecraft : on voit
ce que fait un script, on le modifie et le rendu suit à la frappe. Il sert à
comprendre un shader existant et à mettre au point une technique d’interface
(courbes, portraits, effets de texte) avant de l’essayer en jeu.

![L’écran Shaders : fichiers chargés, scène « Courbe », rendu et éditeur](../site/assets/screens/shaders.png)

## Utilisation

1. **Ouvrir un dossier de shaders…** : le dossier `shaders/` d’un pack, ou
   l’un de ses parents. Seuls les `.vsh`, `.fsh` et `.glsl` sont lus ; les
   chemins sont pris à partir de `shaders/` (`core/item.fsh`,
   `include/ma_lib.glsl`).
2. **Programme** : une paire `.vsh` / `.fsh` trouvée dans le dossier.
3. **Scène** : ce que le jeu enverrait au shader (voir plus bas).
4. **Éditeur** : cliquer un fichier dans la liste l’ouvre ; chaque modification
   recompile et redessine (après un court délai). Les erreurs sont ramenées au
   fichier et à la ligne d’origine, même dans un include ; un clic sur
   `fichier:ligne` ouvre ce fichier.

Les modifications restent dans le studio : le fichier du disque ne change pas.
Recopier le texte dans le pack une fois satisfait.

**Échelle d’interface** reproduit l’échelle de l’interface du jeu (×2 à ×6) :
les shaders qui calculent une épaisseur en pixels d’écran changent d’aspect
avec elle. **Animer `GameTime`** fait avancer le temps du jeu (un cycle de
1 200 secondes, comme une journée de 20 minutes).

## Scènes

| Scène | Programme essayé | Ce qui est dessiné |
|---|---|---|
| Courbe | `core/item` | une zone de 158 × 82 px découpée en colonnes (24 par défaut) ; chaque colonne porte deux valeurs de la série dans sa couleur de sommet (11 bits chacune, tendance, dernière colonne) et pointe dans l’atlas vers une texture « champ » 256 × 256 (rouge = x, vert = y, bleu 167, alpha 251) |
| Portrait | `core/entity` | la face avant d’une tête de joueur de 68 × 70 px, chapeau devant ; skin 64 × 64 par défaut ou fournie |
| Libre | celui du dossier | un quad de 128 × 128 px, coordonnées de texture de 0 à 1 sur une image fournie (damier par défaut), couleur de sommet réglable |

Les scènes « Courbe » et « Portrait » reprennent les techniques d’interface
d’Enderium : on peut y ouvrir leurs shaders tels quels.

## Ce qui est reproduit, ce qui ne l’est pas

Le rendu utilise WebGL2 (GLSL ES 3.00) :

- `#version 330` devient `#version 300 es` avec une précision haute ;
- `#moj_import <minecraft:…>` est remplacé par le fichier du dossier
  (`include/…`), sinon par une version minimale fournie par le studio :
  `dynamictransforms`, `projection`, `globals`, `fog` (sans brouillard),
  `light`, `sample_lightmap` (carte de lumière blanche) ; un include introuvable
  est signalé sous le rendu ;
- attributs `Position`, `Color`, `UV0`, `UV1`, `UV2`, `Normal` ;
- `ProjMat` orthographique en pixels d’interface (y vers le bas),
  `ModelViewMat` et `TextureMat` identité, `ColorModulator` blanc,
  `ScreenSize` en pixels du rendu, `GameTime` ;
- `Sampler0` = texture de la scène sans lissage, `Sampler1` et `Sampler2`
  blancs ; test de profondeur et mélange alpha.

Non reproduit : les autres étapes du jeu (post-effets, cibles de rendu), les
blocs uniformes exacts du jeu (les uniformes sont déclarés un par un), les
`#define` posés par le jeu selon le contexte, les différences de précision entre
GLSL 330 et GLSL ES. Un shader qui compile ici peut donc encore échouer en jeu
(et l’inverse, rarement) : la vérification finale se fait dans Minecraft.

# menu-forge

Studio local pour **dessiner des inventaires Minecraft custom** et les ouvrir en
jeu sans écrire une ligne de calcul de pixels.

Les menus « modernes » des serveurs (onglets, modales, boutons colorés…) ne sont
pas des mods : ce sont des coffres vanilla dont le cadre est masqué, et dont le
**titre** contient des images rendues par une police custom. menu-forge
automatise toute la chaîne :

1. **Studio** (`studio/`) : on dessine le menu sur une toile au pixel près,
   calée sur la grille des slots, à partir de gabarits ; on place les couches,
   les textes dynamiques et les zones cliquables.
2. **Format** (`docs/format.md`) : le studio exporte un fichier `*.menu.json`
   et ses PNG.
3. **Lib** (`lib/`) : côté serveur Paper, elle lit ces fichiers, génère les
   polices du resource pack et ouvre les menus (titre composé selon l’état,
   slots, actions, pagination).

## État

Projet en démarrage. Voir [`docs/rendering.md`](docs/rendering.md) pour le
modèle de rendu et [`docs/format.md`](docs/format.md) pour le format.

## Lancer le studio

```bash
cd studio
npm install
npm run dev
```

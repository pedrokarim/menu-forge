# Menu Forge – contexte pour les assistants

Point d’entrée **indépendant de l’outil** pour tout assistant qui travaille sur
ce dépôt (Claude le lit via `CLAUDE.md`).

## Le projet en une phrase

Un **studio local** pour dessiner des inventaires Minecraft custom (fonds et
boutons rendus par des glyphes de police dans le titre du coffre), qui exporte
un **format pivot** lu par une **lib Paper** capable d’ouvrir ces menus en jeu.

## Structure

| Dossier | Rôle |
|---|---|
| `docs/` | Spécification du format et modèle de rendu (source de vérité) |
| `studio/` | Studio local : interface Vite + React + TypeScript, backend Rust, coquille Tauri |
| `lib/` | Lib Java : noyau autonome (format, police, titre) + runtime Paper |
| `templates/` | Gabarits fournis (coffre, modale, onglets, liste paginée…) |

Premier consommateur : `../enderium-core`, qui branche la lib sur son
infrastructure (ClickAction, RequirementManager, placeholders, pipeline de pack)
via un adaptateur **situé dans enderium-core**, pas ici. La lib ne doit
dépendre d’aucun type Enderium.

## Règles (non négociables)

- **Identifiants en anglais, sans exception** : variables, fonctions, types,
  classes, fichiers, clés JSON du format. Commentaires, JSDoc/Javadoc, textes
  d’interface, docs et messages de commit : **en français**.
- **Commits : auteur unique = Karim.** Aucun `Co-Authored-By: Claude`, aucun
  « Generated with Claude Code », ni dans les commits ni dans les PR.
- **Ne jamais exécuter `git config user.name` / `user.email`** : la config
  globale de la machine s’applique.
- **Pas d’assets tiers dans le dépôt.** Les textures d’un pack de référence
  étudié en local (hors dépôt) servent de référence uniquement ; les gabarits
  fournis ici sont générés ou dessinés par nous.
- Typographie française dans la prose : tiret demi-cadratin (–) entouré
  d’espaces pour une incise, pas de tiret cadratin, guillemets « … ».

## Avant de coder

Lire [`docs/format.md`](docs/format.md) (le contrat entre le studio et la lib)
et [`docs/rendering.md`](docs/rendering.md) (comment une couche devient un
glyphe, et les pièges de calcul d’avance).

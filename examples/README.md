# Espace de travail d’exemple

Dossier utilisé par défaut par le studio (`npm run dev` dans `studio/`).

- `menus/` : les fichiers `*.menu.json` créés depuis le studio ;
- `textures/` : les PNG des couches (générés ou importés).

Pour travailler directement dans un autre dossier (par exemple les ressources
d’un plugin), lancer le studio avec la variable `MENU_FORGE_WORKSPACE` :

```bash
MENU_FORGE_WORKSPACE=../../enderium-core/core/src/main/resources/menu-forge npm run dev
```

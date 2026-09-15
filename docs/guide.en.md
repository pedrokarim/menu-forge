# Getting-started guide

From installation to a first menu opened in game, on Java and then on Bedrock.
Each step points to the reference page that covers it in detail; the full
table of contents of the documentation is in the [index](README.en.md).

## 1. Installing and launching the studio

Prerequisites: **Node 24**, **stable Rust** (1.95 or later) and, on Windows,
**WebView2** (included with Windows 11). For the Java library: **JDK 21**.

```sh
git clone https://github.com/pedrokarim/menu-forge.git
cd menu-forge/studio
npm install
npm run tauri:dev
```

`npm run tauri:dev` opens the desktop app; `npm run dev` serves the same
studio in the browser, at `http://localhost:5173`; `npm run tauri:build`
builds the Windows installer. Options and variants:
[Developing the studio](../studio/README.md) (in French).

On first launch, the studio suggests a **workspace**, `Documents/menu-forge`
(created if missing): the folder where the menus (`menus/`), the assets
(`assets/`), the pixel images (`pixels/`) and the textures (`textures/`) live.

## 2. The home screen

![The studio's home screen: quick actions, example gallery and recent documents with their thumbnails](../site/assets/screens/home.png)

- **Actions rapides** ("Quick actions"): Nouveau menu ("New menu"), Générer
  une interface ("Generate an interface"), Nouvel asset ("New asset"),
  Nouvelle image ("New image"), Importer un écran ("Import a screen"), Ouvrir
  un espace ("Open a workspace");
- at the top of the section, **Voir les exemples** ("See the examples", the
  generator's gallery) and **Générer une interface par IA…** ("Generate an
  interface with AI…");
- **Documents récents** ("Recent documents"), with their thumbnails; right-click
  or the "…" button to rename, duplicate or move to the trash.

Every screen: [Studio screens](screens.md) (in French). The `?` key opens the
shortcut cheat sheet ([Keyboard shortcuts](shortcuts.md), in French).

## 3. A first Java menu

On Java, a menu is a vanilla chest whose **title** carries the visuals, as
font glyphs: the MenuForge Paper plugin opens it in game. The principle is
explained in the [rendering model](rendering.md) (in French).

### 3.1 Starting from an example

**Voir les exemples** opens the interface generator's gallery: 22 ready-made
interfaces, which can be filtered by type and by style family. A click loads
an example into the settings, **Personnaliser** ("Customize") lets you touch it
up, and a double-click creates the menu as is.

![The interface generator's example gallery, with the "Marché" ("Market") example selected](../site/assets/screens/interface-examples.png)

You can also start from **Nouveau menu**: a blank chest, a template (classic
chest, modal, tab bar, paginated list) or **Générer une interface…**. Types,
families and settings: [Interface and texture generator](generator.md)
(in French).

### 3.2 Refining in the editor

![The menu editor: a tabbed shop, with the "Acheter" ("Buy") button selected and its inspector](../site/assets/screens/menu-editor.png)

- on the left, the menu's **layers**, **texts** and **slot areas**, and the
  texture library;
- in the center, the **canvas**, snapped to the chest grid: `V` selects, `S`
  draws a slot area, `Z` zooms;
- on the right, the **inspector** for the selection: position, texture,
  conditions and, for a slot, its click actions and its item, without writing
  any JSON; below it, the state preview and the **composed title**, token by
  token.

The columns can be resized with the mouse by dragging their edge. Every
gesture: [Menu editor](screens.md#éditeur-de-menus) (in French).

### 3.3 Trying it out

`E` switches to **Essayer** ("Try") mode: a click on a slot runs its actions as
in game (tabs, pages, `open` and `back`, closing), commands and sounds are
written to the log, and the document is never modified. `Esc` returns to
editing.

![The "Essayer" ("Try") mode: the confirmation opened from the shop, the stack of two menus and the log](../site/assets/screens/try-mode.png)

### 3.4 Saving and exporting

1. **Paramètres** ("Settings", `Ctrl+5`), **Export vers le plugin** ("Export
   to the plugin") section: choose the target folder (the "Dossier du serveur
   Java (ressources du plugin)" field, "Java server folder (plugin
   resources)"), the namespace and the `pack_format` of the server's version.
2. `Ctrl+S` saves the menu; `Ctrl+E` exports every chest menu in the
   workspace to `<folder>/menuforge/` (`menus/` and `textures/`).

Test ZIP pack, manifest and details: [Exporting and installing](export.md)
(in French).

### 3.5 Opening it in game on Paper

```sh
cd menu-forge/lib
./gradlew build
```

1. Drop `menu-forge-paper/build/libs/MenuForge-<version>.jar` into the
   `plugins/` folder of a Paper server, version 1.20.6 or later, then start it.
2. Copy `menus/` and `textures/` from the export into
   `plugins/MenuForge/workspace/`.
3. `/menuforge reload`: the plugin regenerates the font pack in
   `plugins/MenuForge/pack/`, to be merged into the server's resource pack.
4. `/menuforge open <id>` opens the menu.

Commands, configuration and API: [Java library and Paper plugin](../lib/README.md)
(in French).

## 4. A first Bedrock form

A **Bedrock form** is the Bedrock client's button form, displayed in one of
the eight layouts of the mc-rs server's `mcrs_ui` pack (grid, image grid,
square image, shop, buttons on the left, buttons at the bottom, message of the
day, recap). It has no Java rendering: only the Bedrock export picks it up.

### 4.1 Creating it

**Nouveau menu**, **Formulaire Bedrock** ("Bedrock form") section: choose a
layout, give it a name (the identifier follows), then **Créer** ("Create").
The form is saved and opens in its editor, with a few starter buttons. The
**Disposition** ("Layout") list, at the top of the left column, changes it at
any time; what each layout reads is described in the
[format](format.md#formulaire-bedrock-form) (in French).

!["Nouveau menu" ("New menu"): the eight Bedrock form layouts, with the grid selected](../site/assets/screens/bedrock-layouts.png)

### 4.2 Buttons and icons

![The Bedrock form editor: the layout and the buttons on the left, the preview in the center, the selected button's inspector on the right](../site/assets/screens/bedrock-form.png)

- **Ajouter** ("Add"), in the list header, adds a button or, depending on the
  layout, a banner or a special button. Dragging a row moves it; a right-click
  duplicates it, moves it up, moves it down or deletes it.
- The inspector edits the selected button: identifier, text, subtitle and
  role. The title, the content and the texts accept `§` codes and variables
  (`{viewer.name}`…).
- **Icône** ("Icon") block: a workspace texture (imported, drawn in the pixel
  editor, taken from a library), copied into the pack on export; a game
  texture referenced by its path (`textures/items/diamond`), never copied; or
  an `https://…` address.

### 4.3 Actions, conditions and testing

- **Actions au clic** ("Click actions"): `open` (a menu or a form; the stack
  keeps the path), `back`, `close`, `setState`, `sound`, `command` (as the
  player or from the console), `custom`. Unless the form is closed, the server
  sends it again after the click.
- **Envoyé si** ("Sent if", `visibleWhen`): a condition on the state or on a
  player flag (`viewer.op`…); when it is false, the button is not sent. The
  index of a click is therefore the **rank among the buttons sent**.
- `E` replays clicks on the preview, as the server does; the preview's flags
  and player name are set in the right column. The preview zooms with `+`,
  `-`, `Shift+0`, `Shift+1` and `Shift+2`.

### 4.4 Exporting for Bedrock

1. **Paramètres › Export pour Bedrock** ("Settings › Export for Bedrock"): the
   server folder; for mc-rs, `menu_forge/export`.
2. In the editor, the **Bedrock** button: every menu and form in the workspace
   goes to this folder, the resource pack into `pack/` and the runtime
   descriptor into `runtime.json`.

### 4.5 Running on mc-rs

In game, `/mf reload` rereads the export, `/mf list` lists the menus and
forms, and `/mf open <id>` opens one. A new visual (a new icon, a chest menu)
also requires the client to reconnect, which reloads the pack. Details:
[Exporting and installing](export.md#sur-un-serveur-bedrock-mc-rs) and
[Menu Forge on Bedrock](bedrock.md) (both in French).

## 5. Generating with AI (optional)

A texture or an interface can also be described to an AI in a few words.
Nothing is sent until a provider is enabled in **Paramètres › IA** ("Settings ›
AI"); API keys go into the system keychain.

1. Enable a provider (online, on this computer or Codex CLI) and, for an
   online service, paste its key.
2. **Générer une interface par IA…** (home screen, menu editor) or
   **Générer une texture par IA…** ("Generate a texture with AI…", pixel
   editor, library).
3. The generation runs as a **background job**: closing the dialog does not
   stop it. A notification follows its progress, the rail shows the number of
   generations in progress, and "Ouvrir" ("Open") brings back the result, to
   be reviewed before saving it.

![An AI generation running in the background: the rail indicator and the progress notifications](../site/assets/screens/ai-jobs.png)

Providers, costs, what is sent and constraints: [AI generation](ai.md)
(in French).

## 6. Going further

- [Studio screens](screens.md) and [Keyboard shortcuts](shortcuts.md)
  (in French);
- [Menu format](format.md) (in French): layers, states, conditions, actions,
  templates, components, forms;
- [Pixel editor](pixels.md) and [free mode](assets.md) (in French);
- [Java rendering model](rendering.md) and [Menu Forge on Bedrock](bedrock.md)
  (in French).

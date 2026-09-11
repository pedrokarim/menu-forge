<p align="center">
  <img src="site/assets/logo.svg" alt="" width="96" height="96">
</p>

<h1 align="center">Menu Forge</h1>

<p align="center"><a href="README.md">Français</a> · <strong>English</strong></p>

<p align="center">
  <strong>Draw custom Minecraft inventories pixel by pixel, then open them in game without computing a single offset.</strong><br>
  A local studio (desktop app or browser) and a Paper library, linked by an open JSON format.
</p>

<p align="center">
  <a href="https://pedrokarim.github.io/menu-forge/en/">Project website</a> ·
  <a href="docs/rendering.md">Rendering model</a> ·
  <a href="docs/format.md">Format</a> ·
  <a href="docs/roadmap.md">Roadmap</a>
</p>

![The Menu Forge menu editor: a tabbed shop, a selected slot and its inspector](site/assets/screens/menu-editor.png)

> **Status: young project, under active development.** The rendering model has
> been validated in game (Paper 1.20.6) and the studio and the library work end
> to end, but there is no published release yet: build from source.
>
> The documentation in `docs/` and the code comments are written in French.

Menu Forge was born for **Enderium**, a Minecraft server: its plugin
(`enderium-core`) is the library's first consumer, wired to its actions,
requirements and resource-pack pipeline through an adapter. The library itself
depends on no Enderium type and works with any Paper server.
Its `/profile` screen is the first real menu rebuilt in the studio, with
generated textures: Enderium's test server loads it, pending validation in
game with a client.

## Why

The "modern" menus you see on Minecraft servers (tabs, modals, colored buttons,
progress bars…) are not mods. They are **vanilla chests** whose frame is hidden
and whose **title** holds images, drawn by a custom font from the resource
pack. The result looks great, but building it by hand is painful: every layer
is a glyph, every glyph has its own `ascent` and advance, and one pixel off
shifts everything that follows.

Menu Forge automates the whole chain:

1. **Studio** (`studio/`): draw the menu on a canvas snapped to the slot grid,
   starting from templates; place layers, dynamic texts, clickable areas and
   their actions.
2. **Format** (`docs/format.md`): the studio exports a `*.menu.json` file and
   its PNGs—readable and easy to version.
3. **Library** (`lib/`): on the Paper server, it reads those files, generates
   the resource-pack fonts and opens the menus (title composed from the current
   state, slots, actions, pagination).

## Features

**Studio**

- Pixel-exact canvas, "slots only" or vanilla chest background, zoom and
  snapping to the slot grid.
- **Generated** layers (beveled panel, button, cell, veil, flat fill) or
  imported PNGs—movable with the mouse and the keyboard, reorderable, croppable
  (atlas sprites).
- Dynamic texts with variables (`{viewer.name}`, `{page.number}`…), aligned
  left, center or right, measured with the game's own advances.
- Slot areas drawn on the grid: button, paginated list, input, decoration;
  click actions (open, back, set state, page, sound, command, custom action).
- State variables, visibility and enabled conditions, preview of every state.
- **Live composed title**, token by token, using the same algorithm as the
  library: what you see is what players get.
- Templates (classic chest, modal, paginated list, tab bar) and inheritance
  (`extends`).
- **Free mode**: an asset editor (callouts, key hints, badges…) exported as PNG
  and as a glyph, ready to drop into any text.
- **Pixel editor** ("Pixels" mode): pencil, eraser, paint bucket, eyedropper,
  line, rectangle, ellipse, rectangular selection, lasso, magic wand, palette
  and document colors, layers (opacity, merge), symmetry, zoom from ×1 to
  ×64; the exported PNG works as is in menus and assets.
- **Editing gestures**: multi-selection (Shift or Ctrl + click, marquee,
  `Ctrl+A`), copy / cut / paste through the system clipboard, align and
  distribute, groups (assets), lock and hide, rename, duplicate or trash a
  document, drag and drop a PNG from the file explorer.
- **No JSON required**: visual editors for click actions (reorderable),
  conditions (an "all", "any", "not" tree), state variables and items
  (MiniMessage with a preview).
- **"Try" mode** (`E`): clicking a slot runs its actions as in game (state,
  pages, `open` and `back`, closing); commands and sounds go to a log, and the
  document is never modified.
- Reusable **components** (`component`, `includes`): a pager or a back button
  drawn once, placed in several menus, offset or prefixed; created from a
  selection, detachable.
- **Export**: "Export to the plugin" (`Ctrl+E`, resolved menus and textures in
  the configured folder) and a test "ZIP pack" (`Ctrl+Shift+E`, fonts,
  textures, `pack.mcmeta`); fonts identical, byte for byte, to the library's.
- **JSON schemas** for menus and assets
  ([`docs/menu.schema.json`](docs/menu.schema.json),
  [`docs/asset.schema.json`](docs/asset.schema.json)) to validate a
  hand-written or generated file.
- Local resource-pack libraries (read-only, never published), undo / redo,
  keyboard shortcuts everywhere, `?` cheat sheet.
- "Deepslate" style: slate, 2 px bevels, gold for selection, purple game-like
  item tooltips.

**Java library** (`lib/`)

- `menu-forge-core` (Java 17, Gson only): parser that reports the faulty key
  path, templates, conditions, PNG measurement, title composition, pack
  generation (one font per menu).
- `menu-forge-paper`: standalone Paper plugin **MenuForge**, with an API and
  extension points (`ListProvider`, `FlagProvider`, `PlaceholderResolver`,
  `ItemFactory`, `CustomActionHandler`), one session per player with a stack
  for `back`, and the `/menuforge open`, `reload`, `calibrate` commands.
- Extra workspaces (`addWorkspace`): a plugin ships its own menus. That is how
  **Enderium's adapter** (in enderium-core) provides its menus, wires `custom`
  actions to its ClickActions and flags to its requirements, and merges the
  generated fonts into its pack.
- Tested: 46 core tests, including the parity cases shared with the studio,
  and 28 plugin tests on a mocked server (MockBukkit).

## Screenshots

| | |
|---|---|
| ![Pixel editor: a tab texture drawn in layers](site/assets/screens/pixel-editor.png) | !["Try" mode: simulated clicks and log](site/assets/screens/try-mode.png) |
| **Pixel editor**: layers, symmetry, palette, zoom up to ×64. | **Try**: actions run as in game, the log follows them. |
| ![Visual editors for a slot's actions and conditions](site/assets/screens/visual-editors.png) | ![Multi-selection and the align bar](site/assets/screens/multi-select.png) |
| **No JSON**: click actions and condition trees, in the inspector. | **Editing gestures**: multi-selection, align and distribute. |
| ![A reusable component and its instance](site/assets/screens/components.png) | ![Export to the plugin and the export menu](site/assets/screens/export.png) |
| **Components**: drawn once, included in several menus. | **Export**: to the plugin (`Ctrl+E`) or as a test ZIP pack. |
| ![Home: quick actions and recent documents](site/assets/screens/home.png) | ![A confirmation modal in the editor](site/assets/screens/modal-editor.png) |
| **Home**: quick actions, recent documents with thumbnails. | **Modals**: veil, centered panel, buttons wired to actions. |
| ![Asset editor: a help callout](site/assets/screens/asset-editor.png) | ![Keyboard shortcuts cheat sheet](site/assets/screens/shortcuts.png) |
| **Free mode**: compose an asset and export it as a glyph. | **Shortcuts**: everything also works from the keyboard. |

The studio's interface is in French.

Every screenshot is produced by a script, on a demo workspace made **only** of
textures generated or drawn by the studio: see [`site/README.md`](site/README.md) (in
French).

## How it works

![The shop canvas and its composed title, token by token](site/assets/screens/title-composition.png)

A Menu Forge menu is an ordinary `generic_9xN` chest. Two resource-pack tricks
do the rest:

1. the chest texture is replaced by a "slots only" image: the frame disappears,
   the slot cells stay;
2. all the visuals are written into the chest's **title**, with a font where
   every character is an image (`bitmap` provider).

For each visible layer, the library writes a **negative or positive space**
that moves the cursor to the right x position, then the layer's **glyph**,
whose `ascent` sets its height (`ascent = 13 − y`). The catch: Minecraft moves
the cursor by the image's last opaque column + 2, not by its width. Menu Forge
crops every layer and **measures its advance from the pixels**, in the studio
as in the library.

Slots remain real slots: a button is an image in the title plus a slot
(usually holding an invisible item) at the same place. The title is drawn
below the items, so a layer can paint a button's background without hiding
its icon.

All the details, measured and validated in game: [`docs/rendering.md`](docs/rendering.md).

## Installation

Requirements: **Node 24**, **Rust stable** (1.95 or later), and on Windows
**WebView2** (bundled with Windows 11). For the library: **JDK 21**.

```sh
git clone https://github.com/pedrokarim/menu-forge.git
cd menu-forge/studio
npm install
```

### The studio as a desktop app (Tauri)

```sh
npm run tauri:dev     # development window
npm run tauri:build   # Windows installer (NSIS)
```

The installer is written to
`studio/src-tauri/target/release/bundle/nsis/`. On first launch, the studio
offers a workspace (`Documents/menu-forge`, created if missing).

### The studio in the browser

```sh
npm run dev
```

Starts the Rust backend (`studio-api`, on `127.0.0.1:5174`) and Vite on
<http://localhost:5173>. The server only listens locally and rejects requests
from any other origin. Options, settings and API: [`studio/README.md`](studio/README.md).

### The Paper library (MenuForge plugin)

```sh
cd lib
./gradlew build
```

The plugin targets **Paper 1.20.6 and later** (Java 21, `api-version` 1.20).
On 1.21.4 and later it can also give invisible buttons an item model
(`item_model`); on older versions it uses `CustomModelData`.

1. Drop `menu-forge-paper/build/libs/MenuForge-<version>.jar` into `plugins/`.
2. Copy the menus exported by the studio into
   `plugins/MenuForge/workspace/menus/` and their images into
   `plugins/MenuForge/workspace/textures/`.
3. On startup (and on every `/menuforge reload`), the plugin generates the font
   pack in `plugins/MenuForge/pack/`: **merge it into your server's resource
   pack**.

The "slots only" chest texture is not provided: your server's pack has to ship
it. API, extension points and configuration: [`lib/README.md`](lib/README.md).

### From the studio to the server

In the menu editor, **Exporter** (Export, `Ctrl+E`) saves the open menu, then
writes every menu of the workspace, templates applied, and the PNGs they use
to `<configured folder>/menuforge/` (`menus/`, `textures/`), along with a
manifest: the next export only removes what the previous one wrote. The folder
is set in **Paramètres › Export vers le plugin** (Settings › Export to the
plugin). For the standalone MenuForge plugin, copy `menus/` and `textures/`
into `plugins/MenuForge/workspace/`; a plugin that ships its own menus
registers them with `addWorkspace`, as Enderium does.

**Pack ZIP** (`Ctrl+Shift+E`) writes `exports/<namespace>-pack.zip` into the
workspace: fonts and textures generated with the same algorithm as the
library (parity checked byte for byte against a shared fixture) and
`pack.mcmeta`, to try without a server.

## Repository layout

| Folder | Role |
|---|---|
| [`docs/`](docs/) | Format specifications and JSON schemas, rendering model, screens, roadmap (source of truth) |
| [`studio/`](studio/) | Studio: Vite + React + TypeScript UI (`src/`), Rust backend (`backend/`), Tauri 2 shell (`src-tauri/`) |
| [`lib/`](lib/) | Java library: standalone core `menu-forge-core` and `menu-forge-paper` plugin |
| [`templates/`](templates/) | Bundled templates (chest, modal, tabs, paginated list) |
| [`examples/`](examples/) | Example workspace for browser mode (content not versioned) |
| [`site/`](site/) | Project website (GitHub Pages) and screenshot script |

## Documentation

The documentation is written in French.

- [`docs/rendering.md`](docs/rendering.md): how a layer becomes a glyph,
  coordinates, `ascent`, advance, known pitfalls.
- [`docs/format.md`](docs/format.md): the `*.menu.json` format (layers, texts,
  slots, state, conditions, actions, templates).
- [`docs/assets.md`](docs/assets.md): the free-mode `*.asset.json` format.
- [`docs/pixels.md`](docs/pixels.md): the pixel editor's `*.pixel.json` format,
  its tools and shortcuts.
- [`docs/menu.schema.json`](docs/menu.schema.json) and
  [`docs/asset.schema.json`](docs/asset.schema.json): the JSON schemas of both
  formats.
- [`docs/screens.md`](docs/screens.md): the application screens.
- [`docs/discord.md`](docs/discord.md): Discord Rich Presence (optional).
- [`studio/README.md`](studio/README.md): run, build, local API.
- [`lib/README.md`](lib/README.md): the library, the plugin and its extension points.

## Roadmap

Living details in [`docs/roadmap.md`](docs/roadmap.md).
Recently landed: the pixel editor, editing gestures, visual editors and "Try"
mode, components, export to the plugin and the ZIP pack, JSON schemas. Next
steps:

- validate Enderium's `/profile` screen in game with a client, then migrate
  its other screens (achievements, realms, houses);
- studio: faithful pixel font for text previews, hand-placed guides, restore
  a document from the trash;
- components: override a single field of an instance element; preview
  "list" slots in "Try" mode;
- pixel editor: animations and sprite sheets, saved palettes, gradients;
- decide what to do with the global chest texture (`generic_54.png`).

## Contributing

Contributions are welcome—please open an issue first to discuss any large
change. A few repository rules (details in [`AGENTS.md`](AGENTS.md)):

- **English identifiers**, no exception (variables, functions, types, files,
  JSON keys of the format); comments, UI texts, docs and commit messages
  **in French**;
- French typography in French prose;
- **no third-party assets** in the repository: the bundled templates and
  textures are generated or drawn by the project;
- before a pull request: `npm run build` and `npm run lint` in `studio/`,
  `cargo test` in `studio/backend/`, `./gradlew build` in `lib/`.

## License

Menu Forge is released under the **MIT** license, © 2026 Karim (pedrokarim): see [`LICENSE`](LICENSE).
Third-party components keep their own licenses (below).

## Credits

| Component | Use | License |
|---|---|---|
| [Pixelarticons](https://github.com/halfmage/pixelarticons) | Icons | MIT |
| [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) | Headings | SIL Open Font License 1.1 |
| [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) | Body text | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | Code and paths | SIL Open Font License 1.1 |
| [React](https://react.dev/) | UI | MIT |
| [Tauri](https://tauri.app/) | Desktop app | MIT or Apache 2.0 |
| [Gson](https://github.com/google/gson) | Format parsing (library) | Apache 2.0 |

The studio bundles the fonts from the `@fontsource` packages (plus Pixelify
Sans in `studio/public/fonts/` for the splash screen); the website self-hosts
them in `site/assets/fonts/`, each with its license.

## Notices

Menu Forge is not affiliated with or endorsed by Mojang; Minecraft is a
trademark of Mojang AB. The repository contains no Minecraft asset: the game
font and third-party packs are only read from the user's machine and remain the
property of their authors.

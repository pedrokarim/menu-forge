<p align="center">
  <img src="site/assets/logo.svg" alt="" width="96" height="96">
</p>

<h1 align="center">Menu Forge</h1>

<p align="center"><a href="README.md">Français</a> · <strong>English</strong></p>

<p align="center">
  <strong>Draw custom Minecraft inventories pixel by pixel, then open them in game on Java and Bedrock alike.</strong><br>
  A local studio (desktop app or browser), a Paper plugin and a Bedrock export, linked by an open JSON format.
</p>

<p align="center">
  <a href="https://pedrokarim.github.io/menu-forge/en/">Project website</a> ·
  <a href="docs/guide.md">Getting-started guide</a> ·
  <a href="https://pedrokarim.github.io/menu-forge/en/docs/">Documentation</a> ·
  <a href="docs/shortcuts.md">Shortcuts</a> ·
  <a href="docs/roadmap.md">Roadmap</a>
</p>

![The Menu Forge menu editor: a tabbed shop, a selected slot and its inspector](site/assets/screens/menu-editor.png)

> **Status: young project, under active development.** Rendering has been
> validated in game (Paper 1.20.6, and a Bedrock client on mc-rs), and the
> studio and the library work end to end, but there is no published release
> yet: build from source.
>
> The studio's interface, the documentation in `docs/` and the code comments
> are written in French.

## Why

The "modern" menus you see on Minecraft servers (tabs, modals, colored
buttons, progress bars…) are not mods: they are **vanilla chests** whose
**title** holds images, drawn by a font from the resource pack. It looks
great, but building it by hand is painful—every layer is a glyph, every glyph
has its own `ascent` and advance, and one pixel off shifts everything that
follows.

Menu Forge automates the whole chain: you draw in the studio, it exports
`*.menu.json` files and their PNGs, and the Paper plugin composes the title
and opens the menu in game. On Bedrock, the same menus and dedicated
**Bedrock forms** are sent as JSON UI to the native mc-rs server.

Menu Forge was born for **Enderium**, a Minecraft server that wires the
library to its actions, requirements and resource pack through an adapter.
The library itself depends on no Enderium type and works with any Paper
server.

## What Menu Forge does

- **Pixel-exact drawing**: a canvas snapped to the slot grid, generated or
  imported layers, dynamic texts measured with the game's own advances, a
  pixel font drawn for the project, a layered pixel editor and a free mode
  for assets.
- **Generate a complete interface**: a shop, a grid, a modal, a paginated
  list or a tab bar, in three style families—or one of the **22 examples**
  in the gallery—then edit it like any other menu.
- **Bring the menu to life, no JSON required**: click actions, condition
  trees, state, reusable components, and a **Try** mode that replays clicks
  as in game.
- **Java and Bedrock**: a Paper plugin that opens chests whose title is
  composed glyph by glyph; a Bedrock export (JSON UI pack and
  `runtime.json`) and forms in the eight layouts of the `mcrs_ui` pack, run
  by mc-rs (`/mf open <id>`).
- **Optional AI**: describe a texture or an interface in a few words, with
  eleven providers; generation runs as a **background job** tracked by
  notifications, and its result is constrained (pixel grid and palette, or
  the format's schema) before you review it. Nothing is sent until you
  enable a provider, and keys stay in the system keychain.
- **Keyboard first**: a shortcut for every gesture, one-key zoom, resizable
  side columns that are remembered, and nothing overflows from 1024 × 600 up
  to the largest screen.
- **Reliable**: the studio and the library produce the same fonts, byte for
  byte (shared fixture), and a 61-test end-to-end suite with a layout checker
  replays the studio in a real browser.

## Screenshots

| | |
|---|---|
| ![The interface generator's example gallery](site/assets/screens/interface-examples.png) | ![The Bedrock form editor](site/assets/screens/bedrock-form.png) |
| **Example gallery**: 22 ready-made interfaces, rendered live. | **Bedrock form**: layout, buttons, icons, a preview true to the pack. |
| ![An AI generation running in the background, tracked by notifications](site/assets/screens/ai-jobs.png) | ![Try mode and its log](site/assets/screens/try-mode.png) |
| **AI in the background**: progress, attempts, notifications. | **Try**: clicks run as they would in game. |
| ![The pixel editor, a layered texture](site/assets/screens/pixel-editor.png) | ![The shop canvas and its composed title, token by token](site/assets/screens/title-composition.png) |
| **Pixel editor**: layers, symmetry, zoom up to ×64. | **Composed title**: every offset, every glyph. |

Every screenshot is on the [project website](https://pedrokarim.github.io/menu-forge/en/#gallery).
They are produced by a script, on a demo workspace made only of textures
generated or drawn by the studio.

## Get started

Requirements: Node 24, stable Rust (1.95 or later), WebView2 on Windows
(included in Windows 11) and, for the library, JDK 21.

```sh
git clone https://github.com/pedrokarim/menu-forge.git
cd menu-forge/studio
npm install
npm run tauri:dev     # desktop app; npm run dev for the browser
```

What comes next—from a first menu to opening it in game on Paper, then on
Bedrock—is in the [getting-started guide](docs/guide.md) (in French).

## Documentation

The [documentation index](https://pedrokarim.github.io/menu-forge/en/docs/)
on the website summarizes every page in English; the pages themselves are in
French, like the studio. The most useful ones:

- [Getting-started guide](docs/guide.md) and [keyboard shortcuts](docs/shortcuts.md);
- [Studio screens](docs/screens.md), [interface generator](docs/generator.md), [AI generation](docs/ai.md);
- [Menu format](docs/format.md) and [rendering model](docs/rendering.md);
- [Exporting and installing](docs/export.md), [library and Paper plugin](lib/README.md), [Bedrock](docs/bedrock.md);
- [Roadmap](docs/roadmap.md).

## Repository layout

| Folder | Purpose |
|---|---|
| [`docs/`](docs/) | Documentation, format specifications and JSON schemas (source of truth) |
| [`studio/`](studio/) | Studio: Vite + React + TypeScript interface (`src/`), Rust backend (`backend/`), Tauri 2 shell (`src-tauri/`) |
| [`lib/`](lib/) | Java library: standalone `menu-forge-core` and the `menu-forge-paper` plugin |
| [`templates/`](templates/) | Bundled templates (chest, modal, tabs, paginated list) |
| [`examples/`](examples/) | Example workspace for browser mode (contents not versioned) |
| [`site/`](site/) | Project website (GitHub Pages), its documentation pages and the screenshot script |

## Contributing

Contributions are welcome—please open an issue first to discuss any
significant change. Repository rules (details in [`AGENTS.md`](AGENTS.md)):

- **identifiers in English**, no exceptions; comments, UI text, docs and
  commit messages **in French**, with French typography;
- **no third-party assets** in the repository: the bundled templates and
  textures are generated or drawn by the project;
- before a pull request: `npm run build`, `npm run lint` and `npm test` in
  `studio/`, `cargo test` in `studio/backend/`, `./gradlew build` in `lib/`,
  and `python site/scripts/build.py` if the docs or the website change.

## License

Menu Forge is released under the **MIT** license, © 2026 Karim (pedrokarim): see [`LICENSE`](LICENSE).
Third-party components keep their own licenses.

| Component | Used for | License |
|---|---|---|
| [Pixelarticons](https://github.com/halfmage/pixelarticons) | Icons | MIT |
| [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) | Headings | SIL Open Font License 1.1 |
| [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) | Body text | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | Code and paths | SIL Open Font License 1.1 |
| [React](https://react.dev/) | Interface | MIT |
| [Tauri](https://tauri.app/) | Desktop app | MIT or Apache 2.0 |
| [Gson](https://github.com/google/gson) | Format parsing (library) | Apache 2.0 |

The studio bundles its fonts from the `@fontsource` packages (plus Pixelify
Sans in `studio/public/fonts/` for the splash screen); the website self-hosts
them in `site/assets/fonts/`, each with its license.

## Notices

Menu Forge is not affiliated with or endorsed by Mojang; Minecraft is a
trademark of Mojang AB. The repository contains no Minecraft assets: the
game's font and third-party packs are only read from the user's machine and
remain the property of their authors.

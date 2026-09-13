# Menu Forge documentation

Menu Forge draws custom Minecraft inventories and opens them in game, on Java
(Paper plugin) and on Bedrock (mc-rs server) alike. This page is the index of
the documentation, in English. The getting-started guide is translated into
English; the other pages are written in French, like the studio's interface:
each summary below says what a page covers, so you know where to look.

The same documentation, with a French index, is also in the repository
([`docs/README.md`](README.md)).

## Getting started

| Page | What it covers |
|---|---|
| [Getting-started guide](guide.en.md) | Installing the studio, then a first Java menu and a first Bedrock form, all the way into the game |

## Using the studio

| Page | What it covers |
|---|---|
| [Studio screens](screens.md) | Home, the editors, libraries, settings, the window, resizable columns and notifications |
| [Keyboard shortcuts](shortcuts.md) | Every shortcut, grouped as in the studio's cheat sheet |
| [Interface and texture generator](generator.md) | The five interface types, the three style families, the 22-example gallery and generated textures |
| [AI generation](ai.md) | The eleven providers, keys, what is sent, constraints, background jobs and their progress |
| [Pixel editor](pixels.md) | The `*.pixel.json` format, tools, layers and PNG export |
| [Free mode: assets](assets.md) | The `*.asset.json` format and export as a font glyph |

## Formats and rendering

| Page | What it covers |
|---|---|
| [Menu format](format.md) | The `*.menu.json` format: layers, texts, slots, state, conditions, actions, templates, components, Bedrock forms |
| [Java rendering model](rendering.md) | How a layer becomes a glyph: coordinates, `ascent`, advance, the pixel font, known pitfalls |
| [`menu.schema.json`](menu.schema.json), [`asset.schema.json`](asset.schema.json) | JSON schemas for menus and assets, to validate a hand-written or generated file |

## From the studio to the server

| Page | What it covers |
|---|---|
| [Exporting and installing](export.md) | The studio's three exports (plugin, test ZIP pack, Bedrock), what they write and where |
| [Java library and Paper plugin](../lib/README.md) | Installing the MenuForge plugin, its commands, configuration and API |
| [Menu Forge on Bedrock](bedrock.md) | The contract between the exporter and a Bedrock server: pack, `runtime.json`, forms, execution |

## The project

| Page | What it covers |
|---|---|
| [Roadmap](roadmap.md) | What is done, what has been verified, what comes next |
| [Developing the studio](../studio/README.md) | Running, building, the local API, unit and end-to-end tests |
| [Discord Rich Presence](discord.md) | The optional presence on your Discord profile |
| [Project website](../site/README.md) | The GitHub Pages website, its documentation pages and its screenshots |

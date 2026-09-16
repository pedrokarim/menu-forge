"""Génère les tables de la police vanilla utilisées par les textes du titre.

Les textes du titre sont écrits avec des copies de la police du jeu à un
`ascent` donné. Dans le jeu, cette police (`font/include/default.json`) répartit
les caractères sur trois planches : `ascii.png` (l’ASCII et quelques signes),
`accented.png` (lettres accentuées, cases de 9 × 12) et
`nonlatin_european.png` (grec, cyrillique, ponctuation typographique…).

Ce script lit ces trois providers **dans le jar client** (ou un dossier
d’assets extrait) et écrit, pour chaque planche, la grille de caractères du jeu
et l’avance de chaque caractère, calculée comme le jeu : dernière colonne non
transparente de la case + 1, à l’échelle `height / hauteur de case`, arrondie,
puis + 1 d’espacement. Seules ces listes et ces nombres sont écrits : aucune
image n’est recopiée.

Sorties (même contenu, trois langages) :

- `lib/menu-forge-core/src/main/java/dev/menuforge/text/VanillaFontData.java` ;
- `studio/src/model/vanillaFontData.ts` ;
- en option, un module Python (`--python chemin.py`) pour un outil tiers.

Usage, depuis `studio/` :

    python scripts/vanilla_font_tables.py --jar <minecraft-client.jar> --version 26.2
    python scripts/vanilla_font_tables.py --assets <dossier contenant assets/> --version 26.2
"""

from __future__ import annotations

import argparse
import io
import json
import unicodedata
import zipfile
from pathlib import Path

from PIL import Image

STUDIO = Path(__file__).resolve().parents[1]
REPOSITORY = STUDIO.parent
JAVA_OUT = REPOSITORY / "lib/menu-forge-core/src/main/java/dev/menuforge/text/VanillaFontData.java"
TS_OUT = STUDIO / "src/model/vanillaFontData.ts"

FONT_JSON = "assets/minecraft/font/include/default.json"
# Planches reprises, dans l’ordre d’écriture des polices de texte.
FILES = ("minecraft:font/ascii.png", "minecraft:font/accented.png", "minecraft:font/nonlatin_european.png")
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
EMPTY = "\0"


class Source:
    """Lecture des assets, dans un jar ou dans un dossier."""

    def __init__(self, jar: Path | None, assets: Path | None) -> None:
        self.zip = zipfile.ZipFile(jar) if jar else None
        self.root = assets

    def read(self, name: str) -> bytes:
        if self.zip:
            return self.zip.read(name)
        assert self.root is not None
        return (self.root / name).read_bytes()


def texture_name(file_id: str) -> str:
    namespace, path = file_id.split(":", 1)
    return f"assets/{namespace}/textures/{path}"


def sheets(source: Source) -> list[dict]:
    providers = json.loads(source.read(FONT_JSON).decode("utf-8"))["providers"]
    by_file = {provider.get("file"): provider for provider in providers if provider.get("type") == "bitmap"}
    ascii_ascent = by_file[FILES[0]]["ascent"]
    result = []
    for file_id in FILES:
        provider = by_file[file_id]
        rows = provider["chars"]
        image = Image.open(io.BytesIO(source.read(texture_name(file_id)))).convert("RGBA")
        columns = len(rows[0])
        cell_width = image.width // columns
        cell_height = image.height // len(rows)
        height = provider.get("height", 8)
        advances = []
        for row_index, row in enumerate(rows):
            if len(row) != columns:
                raise SystemExit(f"{file_id} : ligne {row_index} de longueur {len(row)}")
            line = ""
            for column, char in enumerate(row):
                if char == EMPTY:
                    line += "0"
                    continue
                width = 0
                for x in range(cell_width - 1, -1, -1):
                    left = column * cell_width + x
                    top = row_index * cell_height
                    if any(image.getpixel((left, top + y))[3] for y in range(cell_height)):
                        width = x + 1
                        break
                advance = int(0.5 + width * height / cell_height) + 1
                line += DIGITS[advance]
            advances.append(line)
        result.append({
            "file": file_id,
            "height": height,
            # Décalage par rapport à l’ascent d’ascii.png : garde la même ligne de base.
            "ascent_offset": provider["ascent"] - ascii_ascent,
            "chars": rows,
            "advances": advances,
        })
    return result


def literal(text: str, quote: str) -> str:
    """Chaîne lisible : lettres, chiffres, signes en clair ; le reste en \\uXXXX."""
    out = ""
    for char in text:
        category = unicodedata.category(char)
        if char in (quote, "\\"):
            out += "\\" + char
        elif 0x20 <= ord(char) < 0x7F:
            out += char
        elif category[0] in "LNPS" and category != "Mn" and ord(char) <= 0xFFFF:
            out += char
        elif ord(char) <= 0xFFFF:
            out += f"\\u{ord(char):04x}"
        elif category[0] in "LNPS":
            out += char
        else:
            raise SystemExit(f"caractère non géré : U+{ord(char):X}")
    return quote + out + quote


def header(version: str) -> str:
    return (
        f"Tables générées par studio/scripts/vanilla_font_tables.py depuis le jar client de Minecraft {version}\n"
        "(font/include/default.json et ses trois planches). Ne pas modifier à la main : relancer le script."
    )


def java(data: list[dict], version: str) -> str:
    lines = [
        "package dev.menuforge.text;",
        "",
        "import java.util.List;",
        "",
        "/**",
        *[f" * {line}" for line in header(version).split("\n")],
        " *",
        " * <p>Pour chaque planche de la police vanilla : grille de caractères du jeu",
        " * (U+0000 = case vide) et avance de chaque caractère, un chiffre en",
        " * base 36 par point de code ({@code 0} = case vide).",
        " */",
        "public final class VanillaFontData {",
        "",
        "  /**",
        "   * Une planche : texture, hauteur des glyphes, décalage d’ascent par rapport à",
        "   * {@code ascii.png} (même ligne de base), grille et avances.",
        "   */",
        "  public record Sheet(String file, int height, int ascentOffset, List<String> chars, List<String> advances) {",
        "  }",
        "",
        "  /** Planches, dans l’ordre des providers des polices de texte. */",
        "  public static final List<Sheet> SHEETS = List.of(",
    ]
    for index, sheet in enumerate(data):
        lines.append(f"    new Sheet({literal(sheet['file'], chr(34))}, {sheet['height']}, {sheet['ascent_offset']}, List.of(")
        lines += [f"      {literal(row, chr(34))}," for row in sheet["chars"]]
        lines[-1] = lines[-1].rstrip(",")
        lines.append("    ), List.of(")
        lines += [f"      {literal(row, chr(34))}," for row in sheet["advances"]]
        lines[-1] = lines[-1].rstrip(",")
        lines.append("    ))" + ("," if index < len(data) - 1 else ""))
    lines += [
        "  );",
        "",
        "  private VanillaFontData() {",
        "  }",
        "}",
        "",
    ]
    return "\n".join(lines)


def typescript(data: list[dict], version: str) -> str:
    lines = [
        "/**",
        *[f" * {line}" for line in header(version).split("\n")],
        " *",
        " * Pour chaque planche de la police vanilla : grille de caractères du jeu",
        " * (U+0000 = case vide) et avance de chaque caractère, un chiffre en base 36",
        " * par point de code (`0` = case vide). Même contenu que `VanillaFontData` de la lib.",
        " */",
        "",
        "export interface VanillaSheet {",
        "  file: string;",
        "  /** Hauteur des glyphes (propriété `height` du provider). */",
        "  height: number;",
        "  /** Décalage d’ascent par rapport à `ascii.png` (même ligne de base). */",
        "  ascentOffset: number;",
        "  chars: readonly string[];",
        "  advances: readonly string[];",
        "}",
        "",
        "/** Planches, dans l’ordre des providers des polices de texte. */",
        "export const VANILLA_SHEETS: readonly VanillaSheet[] = [",
    ]
    for sheet in data:
        lines.append("  {")
        lines.append(f"    file: {literal(sheet['file'], chr(39))},")
        lines.append(f"    height: {sheet['height']},")
        lines.append(f"    ascentOffset: {sheet['ascent_offset']},")
        lines.append("    chars: [")
        lines += [f"      {literal(row, chr(39))}," for row in sheet["chars"]]
        lines.append("    ],")
        lines.append("    advances: [")
        lines += [f"      {literal(row, chr(39))}," for row in sheet["advances"]]
        lines.append("    ],")
        lines.append("  },")
    lines += ["];", ""]
    return "\n".join(lines)


def python(data: list[dict], version: str) -> str:
    lines = [
        '"""' + header(version),
        "",
        "Pour chaque planche : grille de caractères du jeu (U+0000 = case vide) et avance de chaque",
        "caractère, un chiffre en base 36 par point de code (0 = case vide).",
        '"""',
        "",
        "SHEETS = [",
    ]
    for sheet in data:
        lines.append("    {")
        lines.append(f"        \"file\": {literal(sheet['file'], chr(34))},")
        lines.append(f"        \"height\": {sheet['height']},")
        lines.append(f"        \"ascent_offset\": {sheet['ascent_offset']},")
        lines.append("        \"chars\": [")
        lines += [f"            {literal(row, chr(34))}," for row in sheet["chars"]]
        lines.append("        ],")
        lines.append("        \"advances\": [")
        lines += [f"            {literal(row, chr(34))}," for row in sheet["advances"]]
        lines.append("        ],")
        lines.append("    },")
    lines += ["]", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jar", type=Path, help="jar client de Minecraft")
    parser.add_argument("--assets", type=Path, help="dossier qui contient assets/minecraft")
    parser.add_argument("--version", required=True, help="version du jeu, citée dans les fichiers générés")
    parser.add_argument("--python", type=Path, help="écrit aussi un module Python")
    args = parser.parse_args()
    if not args.jar and not args.assets:
        parser.error("--jar ou --assets est requis")
    data = sheets(Source(args.jar, args.assets))
    JAVA_OUT.write_text(java(data, args.version), encoding="utf-8", newline="\n")
    TS_OUT.write_text(typescript(data, args.version), encoding="utf-8", newline="\n")
    if args.python:
        args.python.write_text(python(data, args.version), encoding="utf-8", newline="\n")
    for sheet in data:
        count = sum(1 for row in sheet["chars"] for char in row if char != EMPTY)
        print(f"{sheet['file']} : {count} caractères, height {sheet['height']}, décalage d’ascent {sheet['ascent_offset']}")


if __name__ == "__main__":
    main()

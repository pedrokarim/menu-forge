"""Génère le logo de menu-forge à partir de sa définition en pixels.

Le logo : une case d’inventaire dorée posée sur une enclume – le menu qu’on
forge. Une seule définition (les sprites ci-dessous), trois sorties dans
`public/brand/` :

- `logo.svg`      : le logo seul, 24 × 24, fond transparent ;
- `logo-1024.png` : le même, agrandi au pixel près (usage graphique) ;
- `icon-1024.png` : le logo sur une tuile d’ardoise biseautée, pour l’icône
  de l’application (`npx tauri icon public/brand/icon-1024.png`).

Usage : `python scripts/brand.py` depuis `studio/`.
"""

from pathlib import Path

from PIL import Image

PALETTE = {
    "k": (11, 11, 14),  # contour
    "h": (92, 93, 104),  # fer, reflet
    "i": (60, 61, 70),  # fer
    "s": (34, 35, 42),  # fer, ombre
    "y": (255, 230, 145),  # or clair
    "g": (242, 201, 76),  # or
    "G": (143, 108, 20),  # or sombre
    "d": (27, 28, 33),  # intérieur de la case
    "w": (255, 255, 255),  # éclat
}

# L’enclume : table plate, bigorne à gauche, pied évasé.
ANVIL = [
    "..kkkkkkkkkkkkkkkkk.",
    "kkhhhhhhhhhhhhhhhhhk",
    ".kkiiiiiiiiiiiiiiisk",
    "...kkkiiiiiiiiiissk.",
    "......kiiiiiiissk...",
    "......kiiiiiiissk...",
    "....kkiiiiiiiiisskk.",
    "...khhhhhhhhhhhhhssk",
    "...kkkkkkkkkkkkkkkkk",
]

# La case d’inventaire dorée, avec une gemme qui brille au centre.
CELL = [
    "kkkkkkkkkk",
    "kyyyyyyyyk",
    "kyddddddGk",
    "kyddggddGk",
    "kydgwwgdGk",
    "kydgwwgdGk",
    "kyddggddGk",
    "kyddddddGk",
    "kGGGGGGGGk",
    "kkkkkkkkkk",
]

# Étincelle à quatre branches.
SPARK = [
    ".g.",
    "gwg",
    ".g.",
]

SIZE = 24
# (sprite, x, y) : la case repose sur la table de l’enclume.
LAYOUT = [(ANVIL, 2, 14), (CELL, 7, 4), (SPARK, 18, 1)]

TILE_FILL = (38, 39, 46)
TILE_LIGHT = (68, 69, 79)
TILE_DARK = (27, 28, 33)


def compose() -> list[list[str | None]]:
    """Grille 24 × 24 des codes couleur (None = transparent)."""
    grid: list[list[str | None]] = [[None] * SIZE for _ in range(SIZE)]
    for sprite, left, top in LAYOUT:
        for row, line in enumerate(sprite):
            for col, code in enumerate(line):
                if code != ".":
                    grid[top + row][left + col] = code
    return grid


def write_svg(grid: list[list[str | None]], path: Path) -> None:
    """SVG net : un rectangle par suite horizontale de pixels de même couleur."""
    rects = []
    for y, row in enumerate(grid):
        x = 0
        while x < SIZE:
            code = row[x]
            if code is None:
                x += 1
                continue
            start = x
            while x < SIZE and row[x] == code:
                x += 1
            r, g, b = PALETTE[code]
            rects.append(f'<rect x="{start}" y="{y}" width="{x - start}" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE * 8}" height="{SIZE * 8}" '
        'shape-rendering="crispEdges">\n'
        "<title>menu-forge</title>\n" + "\n".join(rects) + "\n</svg>\n"
    )
    path.write_text(svg, encoding="utf-8")


def render(grid: list[list[str | None]], scale: int) -> Image.Image:
    image = Image.new("RGBA", (SIZE * scale, SIZE * scale), (0, 0, 0, 0))
    for y, row in enumerate(grid):
        for x, code in enumerate(row):
            if code is not None:
                block = Image.new("RGBA", (scale, scale), PALETTE[code] + (255,))
                image.paste(block, (x * scale, y * scale))
    return image


def tile(logo: Image.Image, size: int = 1024) -> Image.Image:
    """Tuile d’ardoise biseautée (biseaux de 2 px « logiques », comme l’interface)."""
    unit = size // 32
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inset = unit
    edge = size - unit

    def fill(x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int]) -> None:
        image.paste(Image.new("RGBA", (x1 - x0, y1 - y0), color + (255,)), (x0, y0))

    fill(inset, inset, edge, edge, PALETTE["k"])
    fill(inset + unit, inset + unit, edge - unit, edge - unit, TILE_FILL)
    fill(inset + unit, inset + unit, edge - unit, inset + 2 * unit, TILE_LIGHT)
    fill(inset + unit, inset + unit, inset + 2 * unit, edge - unit, TILE_LIGHT)
    fill(inset + unit, edge - 2 * unit, edge - unit, edge - unit, TILE_DARK)
    fill(edge - 2 * unit, inset + unit, edge - unit, edge - unit, TILE_DARK)
    offset = (size - logo.width) // 2
    image.alpha_composite(logo, (offset, offset))
    return image


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public" / "brand"
    out.mkdir(parents=True, exist_ok=True)
    grid = compose()
    write_svg(grid, out / "logo.svg")
    big = render(grid, 40)  # 960 px
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    canvas.alpha_composite(big, (32, 32))
    canvas.save(out / "logo-1024.png")
    tile(render(grid, 32)).save(out / "icon-1024.png")  # logo de 768 px sur la tuile
    print(f"écrit : {', '.join(p.name for p in sorted(out.iterdir()))}")


if __name__ == "__main__":
    main()

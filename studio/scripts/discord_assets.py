"""Génère les images de la Rich Presence Discord de menu-forge.

Discord n’affiche que des images téléversées dans le portail développeur
(application menu-forge → Rich Presence → Art Assets), chacune sous une clé.
Ce script produit ces images dans `public/brand/discord/`, en pixel art net
(chaque pixel logique est un carré plein : aucun lissage, jamais de flou) :

- `logo.png` (1024 × 1024) : la grande image, clé `logo`. Le logo de
  `brand.py` (réutilisé tel quel) sur une tuile d’ardoise Deepslate biseautée
  qui occupe toute l’image : Discord l’affiche vers 80 px, coins arrondis.
- sept petites images (512 × 512), le médaillon posé sur la grande image
  (Discord l’affiche vers 30 px, dans un rond) : un disque pixel coloré,
  biseauté, avec un pictogramme sombre au centre, sans texte.

  | Clé | Pictogramme | Couleur |
  |---|---|---|
  | `menu` | coffre (icône maison `chest` de l’interface) | or |
  | `asset` | tableau : cadre, soleil, montagne pleine | bleu |
  | `home` | maison | vert |
  | `library` | bibliothèque | violet |
  | `settings` | curseurs | argent |
  | `workspace` | dossier | orange |
  | `about` | information | turquoise |

- `cover.png` (1024 × 576, 16:9) : l’image de couverture (portail : Rich
  Presence → Image d’invitation), sans clé : le logo, le mot-symbole
  « menu-forge » dessiné en pixels et la rangée des sept médaillons.

La clé Discord de chaque image est le nom du fichier sans extension ; le
backend n’accepte que ces clés (`SMALL_IMAGES` dans `backend/src/presence.rs`).

Les tracés des pictogrammes sont ceux de l’interface : pixelarticons (MIT,
© Gerrit Halfmann, recopiés ci-dessous depuis `node_modules/pixelarticons/svg/`)
et le coffre dessiné pour `src/ui/Icon.tsx`. Seule exception, `asset` : l’icône
`image` de pixelarticons (traits en diagonale) devient illisible à 30 px, d’où
un tableau dessiné en aplats. Les couleurs sont celles de `src/index.css`.

Usage, depuis `studio/` : `python scripts/discord_assets.py` (Pillow requis,
comme pour `brand.py`).
"""

import re
from pathlib import Path

from PIL import Image

from brand import compose, render

# ---------------------------------------------------------------- couleurs

Color = tuple[int, int, int]

EDGE: Color = (11, 11, 14)  # --ds-edge : contour
INK: Color = (27, 28, 33)  # --ds-bg : pictogramme
SLATE: Color = (38, 39, 46)  # --ds-panel : ardoise
SLATE_SPECK: Color = (41, 42, 50)  # grain clair de l’ardoise
SLATE_PIT: Color = (35, 36, 42)  # grain sombre de l’ardoise
SLATE_LIGHT: Color = (68, 69, 79)  # biseau éclairé
SLATE_DARK: Color = (27, 28, 33)  # biseau dans l’ombre

# ------------------------------------------------------------ pictogrammes

# Tracés SVG sur la grille 24 × 24 (sous-chemins fermés, sans courbes).
PIXELARTICONS = {
    "home": (
        "M4 20h16v2H4zm16-10h2v10h-2zM2 10h2v10H2zm2-2h2v2H4zm2-2h2v2H6zm2-2h2v2H8zm2-2h4v2h-4zm4 2h2v2h-2zm2 2h2v2h-2z"
        "m2 2h2v2h-2zM8 14h2v6H8zm2-2h4v2h-4zm4 2h2v6h-2z"
    ),
    "library": "M3 4h2v17H3zm4 4h2v13H7zm4-2h2v15h-2zm4 0h2v5h-2zm2 5h2v5h-2zm2 5h2v5h-2z",
    "sliders": (
        "M8 14H7v6H5v-6H2v-2h6v2Zm5 6h-2V10h2v10Zm9-2h-3v2h-2v-2h-1v-2h6v2Zm-3-4h-2V4h2v10ZM7 10H5V4h2v6Zm6-4h2v2H9V6h2V4h2v2Z"
    ),
    "folder": "M4 4h6v2H4zm0 14h16v2H4zM20 8h2v10h-2zM2 6h2v12H2zm8 0h10v2H10z",
    "info-box": "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zm-9 5h2V7h-2zm0 8h2v-6h-2z",
}

# Pictogrammes en rectangles `(x, y, largeur, hauteur)`, comme `pixelIcon` de
# `src/ui/Icon.tsx`.
RECT_ICONS = {
    # Coffre de l’interface : couvercle, corps et loquet.
    "chest": [(4, 4, 16, 2), (2, 6, 2, 12), (20, 6, 2, 12), (2, 18, 20, 2), (4, 10, 6, 2), (14, 10, 6, 2), (10, 8, 4, 6)],
    # Tableau : cadre, soleil, montagne pleine (lisible à 30 px).
    "picture": [
        (4, 2, 16, 2), (4, 20, 16, 2), (2, 4, 2, 16), (20, 4, 2, 16),
        (6, 6, 4, 4),
        (14, 8, 2, 2), (12, 10, 6, 2), (10, 12, 10, 2), (8, 14, 12, 2), (6, 16, 14, 2), (4, 18, 16, 2),
    ],
}

ICON_GRID = 24

Polygon = list[tuple[float, float]]


def parse_path(d: str) -> list[Polygon]:
    """Sous-chemins d’un tracé fait de M/m, H/h, V/v, L/l et Z/z."""
    tokens = re.findall(r"[MmHhVvLlZz]|-?\d*\.?\d+", d)
    polygons: list[Polygon] = []
    current: Polygon = []
    x = y = 0.0
    start = (0.0, 0.0)
    command = ""
    index = 0

    def number() -> float:
        nonlocal index
        value = float(tokens[index])
        index += 1
        return value

    while index < len(tokens):
        token = tokens[index]
        if token.isalpha():
            command = token
            index += 1
            if command in "Zz":
                if current:
                    polygons.append(current)
                current = []
                x, y = start
                continue
        if command in "Mm":
            dx, dy = number(), number()
            x, y = (x + dx, y + dy) if command == "m" else (dx, dy)
            if current:
                polygons.append(current)
            current = [(x, y)]
            start = (x, y)
            command = "l" if command == "m" else "L"  # coordonnées suivantes : lignes
        elif command in "Ll":
            dx, dy = number(), number()
            x, y = (x + dx, y + dy) if command == "l" else (dx, dy)
            current.append((x, y))
        elif command in "Hh":
            value = number()
            x = x + value if command == "h" else value
            current.append((x, y))
        elif command in "Vv":
            value = number()
            y = y + value if command == "v" else value
            current.append((x, y))
        else:
            raise ValueError(f"commande de tracé non prise en charge : {token}")
    if current:
        polygons.append(current)
    return polygons


def inside(polygons: list[Polygon], px: float, py: float) -> bool:
    """Règle pair-impair (les sous-chemins de ces icônes ne se chevauchent pas)."""
    crossings = 0
    for polygon in polygons:
        for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1]):
            if (y0 > py) != (y1 > py) and px < x0 + (py - y0) * (x1 - x0) / (y1 - y0):
                crossings += 1
    return crossings % 2 == 1


def icon_mask(name: str) -> list[list[bool]]:
    """Masque 24 × 24 d’un pictogramme (clé de RECT_ICONS ou de PIXELARTICONS)."""
    mask = [[False] * ICON_GRID for _ in range(ICON_GRID)]
    if name in RECT_ICONS:
        for left, top, width, height in RECT_ICONS[name]:
            for y in range(top, top + height):
                for x in range(left, left + width):
                    mask[y][x] = True
        return mask
    polygons = parse_path(PIXELARTICONS[name])
    for y in range(ICON_GRID):
        for x in range(ICON_GRID):
            mask[y][x] = inside(polygons, x + 0.5, y + 0.5)
    return mask


# ----------------------------------------------------------- petites images

# clé Discord → (pictogramme, couleur du disque)
SMALL_IMAGES: dict[str, tuple[str, Color]] = {
    "menu": ("chest", (242, 201, 76)),  # --ds-gold
    "asset": ("picture", (143, 199, 255)),  # --ds-info, --kind-image
    "home": ("home", (76, 208, 125)),  # --ds-ok
    "library": ("library", (201, 168, 255)),  # --ds-tip-title
    "settings": ("sliders", (200, 198, 212)),  # argent, proche de --ds-muted éclairci
    "workspace": ("folder", (255, 180, 92)),  # --ds-warn
    "about": ("info-box", (63, 184, 176)),  # --kind-box
}

SMALL_SIZE = 512
# Grille du médaillon : 32 × 32 cases de 16 px. Le pictogramme 24 × 24 y est
# posé au centre (cases 4 à 27), à la même échelle.
BADGE_GRID = 32
BADGE_UNIT = SMALL_SIZE // BADGE_GRID


def shade(color: Color, factor: float) -> Color:
    """Éclaircit (facteur > 1, vers le blanc) ou assombrit (facteur < 1) une couleur."""
    if factor >= 1:
        return tuple(round(c + (255 - c) * (factor - 1)) for c in color)  # type: ignore[return-value]
    return tuple(round(c * factor) for c in color)  # type: ignore[return-value]


def in_disc(x: int, y: int, radius: float) -> bool:
    center = BADGE_GRID / 2
    return (x + 0.5 - center) ** 2 + (y + 0.5 - center) ** 2 <= radius**2


def badge(icon: str, color: Color) -> Image.Image:
    """Disque pixel biseauté (lumière en haut à gauche) et pictogramme sombre."""
    light, dark = shade(color, 1.45), shade(color, 0.62)
    grid: list[list[Color | None]] = [[None] * BADGE_GRID for _ in range(BADGE_GRID)]
    for y in range(BADGE_GRID):
        for x in range(BADGE_GRID):
            if not in_disc(x, y, 16):
                continue
            if not in_disc(x, y, 15):
                grid[y][x] = EDGE
            elif not in_disc(x - 1, y, 15) or not in_disc(x, y - 1, 15):
                grid[y][x] = light
            elif not in_disc(x + 1, y, 15) or not in_disc(x, y + 1, 15):
                grid[y][x] = dark
            else:
                grid[y][x] = color
    offset = (BADGE_GRID - ICON_GRID) // 2
    mask = icon_mask(icon)
    for y, row in enumerate(mask):
        for x, filled in enumerate(row):
            # Ombre portée d’une case (en bas à droite) : le pictogramme se détache.
            if filled and not (y + 1 < ICON_GRID and x + 1 < ICON_GRID and mask[y + 1][x + 1]):
                grid[offset + y + 1][offset + x + 1] = dark
    for y, row in enumerate(mask):
        for x, filled in enumerate(row):
            if filled:
                grid[offset + y][offset + x] = INK
    return paint(grid, BADGE_UNIT)


def paint(grid: list[list[Color | None]], unit: int) -> Image.Image:
    """Agrandissement au plus proche voisin : une case = un carré plein."""
    image = Image.new("RGBA", (len(grid[0]) * unit, len(grid) * unit), (0, 0, 0, 0))
    for y, row in enumerate(grid):
        for x, color in enumerate(row):
            if color is not None:
                image.paste(color + (255,), (x * unit, y * unit, (x + 1) * unit, (y + 1) * unit))
    return image


# ------------------------------------------------------------ grande image

LARGE_SIZE = 1024
# Tuile : 64 × 64 cases de 16 px ; contour d’une case, biseaux de deux.
TILE_GRID = 64
TILE_UNIT = LARGE_SIZE // TILE_GRID
LOGO_SCALE = 36  # logo 24 × 24 agrandi à 864 px, centré


def speck(x: int, y: int) -> int:
    """Bruit déterministe (0 à 99) : le grain de l’ardoise est identique à chaque génération."""
    value = (x * 73856093) ^ (y * 19349663) ^ 0x5F3759DF
    value = (value ^ (value >> 13)) * 1274126177
    return (value ^ (value >> 16)) % 100


def slate_tile(cols: int, rows: int) -> list[list[Color | None]]:
    """Tuile d’ardoise : contour d’une case, biseaux de deux (lumière en haut à gauche), grain."""
    grid: list[list[Color | None]] = [[None] * cols for _ in range(rows)]
    last_x, last_y = cols - 1, rows - 1
    for y in range(rows):
        for x in range(cols):
            edge_distance = min(x, y, last_x - x, last_y - y)
            if edge_distance == 0:
                grid[y][x] = EDGE
            elif x in (1, 2) and y <= last_y - x or y in (1, 2) and x <= last_x - y:
                grid[y][x] = SLATE_LIGHT
            elif edge_distance <= 2:
                grid[y][x] = SLATE_DARK
            else:
                grain = speck(x, y)
                grid[y][x] = SLATE_SPECK if grain < 6 else SLATE_PIT if grain < 12 else SLATE
    return grid


def large_logo() -> Image.Image:
    image = paint(slate_tile(TILE_GRID, TILE_GRID), TILE_UNIT)
    logo = render(compose(), LOGO_SCALE)
    offset = (LARGE_SIZE - logo.width) // 2
    image.alpha_composite(logo, (offset, offset))
    return image


# ------------------------------------------------------------- couverture

# Image de couverture (portail : Rich Presence → Image d’invitation) : 1024 × 576,
# 16:9. Grille de cases de 8 px (128 × 72) : ardoise, logo à gauche, mot-symbole
# et rangée des médaillons à droite. Pas de petit texte : l’invitation montre
# la couverture en réduction.
COVER_WIDTH, COVER_HEIGHT = 1024, 576
COVER_UNIT = 8
TEXT: Color = (247, 245, 251)  # --ds-ink-strong
GOLD: Color = (242, 201, 76)  # --ds-gold
COVER_LOGO_SCALE = 16  # logo 24 × 24 agrandi à 384 px
COVER_LOGO_AT = (64, 96)  # centré verticalement
WORDMARK_AT = (61, 26)  # en cases : (488 px, 208 px)
BADGES_AT = (488, 304)  # médaillons de 64 px (une case de médaillon = 2 px)
BADGE_PREVIEW = 64
BADGE_GAP = 4

# Police pixel du mot-symbole : 5 × 8 cases, ligne de base à la 7e rangée,
# jambage du « g » sur la 8e. Avance : 6 cases.
WORDMARK_FONT = {
    "m": [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#.#.#", "....."],
    "e": [".....", ".....", ".###.", "#...#", "#####", "#....", ".###.", "....."],
    "n": [".....", ".....", "#.##.", "##..#", "#...#", "#...#", "#...#", "....."],
    "u": [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#", "....."],
    "-": [".....", ".....", ".....", ".....", ".###.", ".....", ".....", "....."],
    "f": ["..##.", ".#...", "####.", ".#...", ".#...", ".#...", ".#...", "....."],
    "o": [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###.", "....."],
    "r": [".....", ".....", "#.##.", "##..#", "#....", "#....", "#....", "....."],
    "g": [".....", ".....", ".####", "#...#", "#...#", ".####", "....#", "####."],
}
WORDMARK = "menu-forge"


def cover() -> Image.Image:
    grid = slate_tile(COVER_WIDTH // COVER_UNIT, COVER_HEIGHT // COVER_UNIT)
    left, top = WORDMARK_AT
    cells: list[tuple[int, int, Color]] = []
    for index, char in enumerate(WORDMARK):
        color = GOLD if char == "-" else TEXT
        for y, line in enumerate(WORDMARK_FONT[char]):
            for x, mark in enumerate(line):
                if mark == "#":
                    cells.append((left + index * 6 + x, top + y, color))
    # Ombre d’une case en bas à droite d’abord, lettres ensuite : l’ombre ne mord jamais une lettre voisine.
    for x, y, _ in cells:
        grid[y + 1][x + 1] = EDGE
    for x, y, color in cells:
        grid[y][x] = color
    image = paint(grid, COVER_UNIT)
    image.alpha_composite(render(compose(), COVER_LOGO_SCALE), COVER_LOGO_AT)
    for index, (icon, color) in enumerate(SMALL_IMAGES.values()):
        preview = badge(icon, color).resize((BADGE_PREVIEW, BADGE_PREVIEW), Image.NEAREST)
        image.alpha_composite(preview, (BADGES_AT[0] + index * (BADGE_PREVIEW + BADGE_GAP), BADGES_AT[1]))
    return image


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public" / "brand" / "discord"
    out.mkdir(parents=True, exist_ok=True)
    large_logo().save(out / "logo.png")
    for key, (icon, color) in SMALL_IMAGES.items():
        badge(icon, color).save(out / f"{key}.png")
    cover().convert("RGB").save(out / "cover.png")
    names = ["logo"] + list(SMALL_IMAGES) + ["cover"]
    print(f"écrit dans {out} : {', '.join(f'{name}.png' for name in names)}")


if __name__ == "__main__":
    main()

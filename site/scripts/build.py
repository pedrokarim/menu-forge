"""Prépare index.html : sprite des icônes et dimensions des captures.

- Le sprite SVG (entre <!-- ICONS --> et <!-- /ICONS -->) est régénéré à
  partir des icônes réellement utilisées (`#i-<nom>`) : pixelarticons (MIT,
  lues dans studio/node_modules/pixelarticons/svg) ou dessins maison sur la
  même grille 24 × 24, repris de studio/src/ui/Icon.tsx.
- Les attributs width / height des images `assets/screens/*.png` sont
  alignés sur la taille réelle des PNG (pas de décalage au chargement).

Usage, depuis site/ : python scripts/build.py
"""
import re
import struct
import sys
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent
INDEX = SITE_DIR / "index.html"
PIXELARTICONS = SITE_DIR.parent / "studio" / "node_modules" / "pixelarticons" / "svg"

# Nom utilisé dans la page → fichier pixelarticons.
ICON_FILES = {
    "arrow-right": "arrow-right",
    "book": "book-open",
    "check": "check",
    "chevron-left": "chevron-left",
    "chevron-right": "chevron-right",
    "close": "close",
    "code": "code",
    "copy": "copy",
    "download": "download",
    "eye": "eye",
    "file": "file-text",
    "folder": "folder",
    "github": "github",
    "globe": "globe",
    "grid": "grid-3x3",
    "home": "home",
    "image": "image",
    "info": "info-box",
    "keyboard": "keyboard",
    "laptop": "laptop",
    "server": "server",
    "sliders": "sliders",
    "sparkles": "sparkles",
    "terminal": "terminal",
    "text": "letter-t",
    "warning": "warning-diamond",
}

# Dessins maison (rectangles [x, y, largeur, hauteur]), comme dans Icon.tsx.
CUSTOM_ICONS = {
    "chest": [
        (4, 4, 16, 2), (2, 6, 2, 12), (20, 6, 2, 12), (2, 18, 20, 2),
        (4, 10, 6, 2), (14, 10, 6, 2), (10, 8, 4, 6),
    ],
    "cursor": [
        (5, 2, 2, 2), (5, 4, 4, 2), (5, 6, 6, 2), (5, 8, 8, 2), (5, 10, 10, 2),
        (5, 12, 12, 2), (5, 14, 8, 2), (5, 16, 2, 2), (9, 16, 4, 2), (11, 18, 4, 2), (11, 20, 4, 2),
    ],
}


def icon_body(name: str) -> str:
    if name in CUSTOM_ICONS:
        path = "".join(f"M{x} {y}h{w}v{h}h{-w}z" for x, y, w, h in CUSTOM_ICONS[name])
        return f'<path d="{path}"/>'
    if name not in ICON_FILES:
        sys.exit(f"Icône inconnue : {name} (ajouter une entrée à ICON_FILES)")
    source = (PIXELARTICONS / f"{ICON_FILES[name]}.svg").read_text(encoding="utf-8")
    match = re.search(r"<svg[^>]*>(.*)</svg>", source, re.S)
    if not match:
        sys.exit(f"SVG illisible : {ICON_FILES[name]}.svg")
    body = re.sub(r'\s(fill|class)="[^"]*"', "", match.group(1))
    return re.sub(r">\s+<", "><", body.strip())


def sprite(names: list[str]) -> str:
    symbols = "".join(f'<symbol id="i-{name}" viewBox="0 0 24 24">{icon_body(name)}</symbol>' for name in names)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" '
        'style="position:absolute;width:0;height:0;overflow:hidden">' + symbols + "</svg>"
    )


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    return struct.unpack(">II", header[16:24])


def fix_dimensions(html: str) -> str:
    def replace(match: re.Match) -> str:
        tag = match.group(0)
        source = re.search(r'src="(assets/screens/[^"]+\.png)"', tag).group(1)
        path = SITE_DIR / source
        if not path.exists():
            print(f"absente : {source}")
            return tag
        width, height = png_size(path)
        tag = re.sub(r'width="\d+"', f'width="{width}"', tag)
        return re.sub(r'height="\d+"', f'height="{height}"', tag)

    return re.sub(r'<img\b[^>]*src="assets/screens/[^"]+"[^>]*>', replace, html, flags=re.S)


def main() -> None:
    html = INDEX.read_text(encoding="utf-8")
    names = sorted(set(re.findall(r'href="#i-([a-z0-9-]+)"', html)))
    html = re.sub(
        r"<!-- ICONS -->.*?<!-- /ICONS -->",
        lambda _: f"<!-- ICONS -->{sprite(names)}<!-- /ICONS -->",
        html,
        flags=re.S,
    )
    html = fix_dimensions(html)
    INDEX.write_text(html, encoding="utf-8", newline="\n")
    print(f"index.html : {len(names)} icônes, dimensions des captures à jour")


if __name__ == "__main__":
    main()

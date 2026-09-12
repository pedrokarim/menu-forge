"""Prépare le site : pages de documentation, sprite des icônes, dimensions des captures, liens.

- Pages d’accueil (index.html en français, en/index.html en anglais) : le sprite SVG (entre
  <!-- ICONS --> et <!-- /ICONS -->) est régénéré à partir des icônes réellement utilisées
  (`#i-<nom>`) : pixelarticons (MIT, lues dans studio/node_modules/pixelarticons/svg) ou
  dessins maison sur la même grille 24 × 24, repris de studio/src/ui/Icon.tsx.
- Pages de documentation : chaque Markdown de DOC_PAGES (docs/*.md, lib/README.md,
  studio/README.md) devient site/docs/<page>.html, au style du site ; docs/README.en.md devient
  l’index anglais, site/en/docs/index.html. Les schémas JSON sont publiés à côté des pages.
  Ces pages sont générées : ni versionnées, ni à retoucher à la main.
- Les attributs width / height des captures (assets/screens/*.png) sont alignés sur la taille
  réelle des PNG (pas de décalage au chargement).
- Vérifications : tout lien interne (accueil, documentation, captures) mène à un fichier qui
  existe, et toute ancre à un identifiant de la page visée. Une erreur arrête le script.

Usage, depuis la racine du dépôt :
  python site/scripts/build.py          tout (le sprite demande studio/node_modules)
  python site/scripts/build.py --docs   documentation et vérifications seulement, sans
                                        dépendance : c’est ce que lance le workflow Pages
"""
import html
import os
import re
import shutil
import struct
import sys
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SITE_DIR.parent
HOME_PAGES = [SITE_DIR / "index.html", SITE_DIR / "en" / "index.html"]
DOCS_OUT = SITE_DIR / "docs"
DOCS_OUT_EN = SITE_DIR / "en" / "docs"
PIXELARTICONS = REPO_DIR / "studio" / "node_modules" / "pixelarticons" / "svg"
GITHUB = "https://github.com/pedrokarim/menu-forge"
SITE_URL = "https://pedrokarim.github.io/menu-forge"

# Nom utilisé dans les pages → fichier pixelarticons.
ICON_FILES = {
    "arrow-right": "arrow-right",
    "arrows-horizontal": "arrows-horizontal",
    "article": "article",
    "bell": "bell",
    "blocks": "blocks",
    "book": "book-open",
    "braces": "braces",
    "braces-off": "braces-off",
    "check": "check",
    "clock": "clock",
    "chevron-left": "chevron-left",
    "chevron-right": "chevron-right",
    "close": "close",
    "code": "code",
    "copy": "copy",
    "download": "download",
    "drag": "drag-and-drop",
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
    "layout": "layout",
    "pencil": "pencil",
    "play": "play",
    "robot": "robot",
    "server": "server",
    "sliders": "sliders",
    "sparkles": "sparkles",
    "terminal": "terminal",
    "text": "letter-t",
    "upload": "upload",
    "warning": "warning-diamond",
    "zoom-in": "zoom-in",
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

# Pages de documentation : nom du fichier HTML, source dans le dépôt, libellé du menu latéral.
DOC_PAGES = [
    ("index", "docs/README.md", "Sommaire"),
    ("guide", "docs/guide.md", "Guide de prise en main"),
    ("screens", "docs/screens.md", "Écrans du studio"),
    ("shortcuts", "docs/shortcuts.md", "Raccourcis clavier"),
    ("generator", "docs/generator.md", "Générateur d’interfaces"),
    ("ai", "docs/ai.md", "Génération par IA"),
    ("pixels", "docs/pixels.md", "Éditeur de pixels"),
    ("assets", "docs/assets.md", "Mode libre (assets)"),
    ("format", "docs/format.md", "Format des menus"),
    ("rendering", "docs/rendering.md", "Modèle de rendu Java"),
    ("export", "docs/export.md", "Exporter et installer"),
    ("lib", "lib/README.md", "Lib Java et plugin Paper"),
    ("bedrock", "docs/bedrock.md", "Menu Forge sur Bedrock"),
    ("roadmap", "docs/roadmap.md", "Feuille de route"),
    ("studio", "studio/README.md", "Développer le studio"),
    ("discord", "docs/discord.md", "Rich Presence Discord"),
]
# Groupes du menu latéral, dans l’ordre de lecture (liens « précédent » et « suivant »).
DOC_GROUPS = [
    ("Commencer", ["index", "guide"]),
    ("Utiliser le studio", ["screens", "shortcuts", "generator", "ai", "pixels", "assets"]),
    ("Formats et rendu", ["format", "rendering"]),
    ("Du studio au serveur", ["export", "lib", "bedrock"]),
    ("Le projet", ["roadmap", "studio", "discord"]),
]
EN_INDEX = "docs/README.en.md"
# Publiés tels quels à côté des pages : une adresse stable pour "$schema".
DOC_FILES = ["docs/menu.schema.json", "docs/asset.schema.json"]
# Icônes des pages de documentation, reprises du sprite de la page d’accueil.
DOC_ICONS = ["chevron-left", "chevron-right", "close", "github"]

TEXT = {
    "fr": {
        "skip": "Aller au contenu",
        "nav": "Navigation du site",
        "home": "Accueil",
        "docs": "Documentation",
        "guide": "Guide",
        "shortcuts": "Raccourcis",
        "language": "Langue",
        "github": "Code source sur GitHub",
        "menu": "Pages de la documentation",
        "toc": "Sur cette page",
        "source": "Source",
        "edit": "Proposer une modification",
        "previous": "Page précédente",
        "next": "Page suivante",
        "footer": "Studio d’inventaires Minecraft à base de glyphes de police, conçu pour Enderium. Licence MIT.",
        "viewer": "Capture agrandie",
        "viewer_previous": "Capture précédente",
        "viewer_next": "Capture suivante",
        "viewer_close": "Fermer la visionneuse",
        "title_suffix": "Documentation de Menu Forge",
    },
    "en": {
        "skip": "Skip to content",
        "nav": "Site navigation",
        "home": "Home",
        "docs": "Documentation",
        "guide": "Guide",
        "shortcuts": "Shortcuts",
        "language": "Language",
        "github": "Source code on GitHub",
        "menu": "Documentation pages",
        "toc": "On this page",
        "source": "Source",
        "edit": "Suggest an edit",
        "previous": "Previous page",
        "next": "Next page",
        "footer": "A Minecraft inventory studio built on font glyphs, made for Enderium. MIT license.",
        "viewer": "Enlarged screenshot",
        "viewer_previous": "Previous screenshot",
        "viewer_next": "Next screenshot",
        "viewer_close": "Close the viewer",
        "title_suffix": "Menu Forge documentation",
    },
}


class BuildError(Exception):
    pass


errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def relative(target: Path, start: Path) -> str:
    return os.path.relpath(target, start).replace(os.sep, "/")


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    return struct.unpack(">II", header[16:24])


# ---------------------------------------------------------------------------
# Icônes
# ---------------------------------------------------------------------------


def icon_body(name: str) -> str:
    if name in CUSTOM_ICONS:
        path = "".join(f"M{x} {y}h{w}v{h}h{-w}z" for x, y, w, h in CUSTOM_ICONS[name])
        return f'<path d="{path}"/>'
    if name not in ICON_FILES:
        raise BuildError(f"Icône inconnue : {name} (ajouter une entrée à ICON_FILES)")
    source = (PIXELARTICONS / f"{ICON_FILES[name]}.svg").read_text(encoding="utf-8")
    match = re.search(r"<svg[^>]*>(.*)</svg>", source, re.S)
    if not match:
        raise BuildError(f"SVG illisible : {ICON_FILES[name]}.svg")
    body = re.sub(r'\s(fill|class)="[^"]*"', "", match.group(1))
    return re.sub(r">\s+<", "><", body.strip())


def sprite_from_symbols(symbols: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" '
        'style="position:absolute;width:0;height:0;overflow:hidden">' + symbols + "</svg>"
    )


def sprite(names: list[str]) -> str:
    return sprite_from_symbols(
        "".join(f'<symbol id="i-{name}" viewBox="0 0 24 24">{icon_body(name)}</symbol>' for name in names)
    )


def doc_sprite() -> str:
    """Symboles des pages de documentation, repris du sprite déjà construit de l’accueil."""
    home = HOME_PAGES[0].read_text(encoding="utf-8")
    symbols = []
    for name in DOC_ICONS:
        match = re.search(rf'<symbol id="i-{name}"[^>]*>.*?</symbol>', home, re.S)
        if not match:
            raise BuildError(f"icône « {name} » absente du sprite de index.html : l’utiliser sur l’accueil")
        symbols.append(match.group(0))
    return sprite_from_symbols("".join(symbols))


# ---------------------------------------------------------------------------
# Markdown → HTML (le sous-ensemble employé par la documentation du dépôt)
# ---------------------------------------------------------------------------

FENCE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
LIST_ITEM = re.compile(r"^(\s*)([-*+]|\d+[.)])(\s+)(.*)$")
TABLE_SEPARATOR = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
RULE = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$")
HTML_BLOCK = re.compile(r"^<(p|div|table|details|h[1-6]|img|figure)\b", re.I)
IMAGE_ONLY = re.compile(r'^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$')


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def plain(html_text: str) -> str:
    """Texte d’un fragment HTML (titres, descriptions)."""
    return html.unescape(re.sub(r"<[^>]+>", "", html_text))


class Page:
    def __init__(self, name: str, source: str, label: str, out_path: Path, lang: str):
        self.name = name
        self.source = source
        self.label = label
        self.out_path = out_path
        self.lang = lang
        self.title = label
        self.description = ""
        self.headings: list[tuple[int, str, str]] = []
        self.links: list[tuple[str, Path, str]] = []
        self.has_figures = False
        self.html = ""


class Renderer:
    def __init__(self, page: Page, pages_by_source: dict[str, Page]):
        self.page = page
        self.pages_by_source = pages_by_source
        self.used_ids: dict[str, int] = {}

    # --- identifiants des titres, comme GitHub ---

    def heading_id(self, text: str) -> str:
        slug = re.sub(r"[^\w\- ]", "", text.strip().lower()).replace(" ", "-")
        count = self.used_ids.get(slug, 0)
        self.used_ids[slug] = count + 1
        return slug if count == 0 else f"{slug}-{count}"

    # --- liens ---

    def resolve(self, href: str) -> str:
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", href) or href.startswith("//"):
            return href
        path, _, anchor = href.partition("#")
        suffix = f"#{anchor}" if anchor else ""
        if not path:
            self.page.links.append((href, self.page.out_path, anchor))
            return href
        target = Path(os.path.normpath((REPO_DIR / self.page.source).parent / path))
        try:
            repo_path = target.relative_to(REPO_DIR).as_posix()
        except ValueError:
            fail(f"{self.page.source} : lien hors du dépôt : {href}")
            return href
        start = self.page.out_path.parent
        if repo_path in self.pages_by_source:
            out = self.pages_by_source[repo_path].out_path
            self.page.links.append((href, out, anchor))
            return relative(out, start) + suffix
        if repo_path in DOC_FILES:
            return relative(DOCS_OUT / Path(repo_path).name, start) + suffix
        if not target.exists():
            fail(f"{self.page.source} : lien mort : {href}")
            return href
        if repo_path.startswith("site/assets/"):
            return relative(target, start) + suffix
        kind = "tree" if target.is_dir() else "blob"
        return f"{GITHUB}/{kind}/main/{repo_path}{suffix}"

    def target_page(self, href: str) -> "Page | None":
        """Page de documentation visée par un lien relatif, s’il en vise une."""
        path = href.partition("#")[0]
        if not path or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", href):
            return None
        target = Path(os.path.normpath((REPO_DIR / self.page.source).parent / path))
        try:
            return self.pages_by_source.get(target.relative_to(REPO_DIR).as_posix())
        except ValueError:
            return None

    def image(self, alt: str, src: str) -> tuple[str, str]:
        """Adresse publiée d’une image et ses attributs de taille."""
        url = self.resolve(src)
        target = Path(os.path.normpath((REPO_DIR / self.page.source).parent / src))
        size = ""
        if target.suffix == ".png" and target.exists():
            width, height = png_size(target)
            size = f' width="{width}" height="{height}"'
        return url, size

    # --- en ligne ---

    def inline(self, text: str) -> str:
        slots: list[str] = []

        def stash(value: str) -> str:
            slots.append(value)
            return f"\x00{len(slots) - 1}\x00"

        def code(match: re.Match) -> str:
            content = match.group(2)
            if len(content) > 1 and content.startswith(" ") and content.endswith(" "):
                content = content[1:-1]
            # Coupures possibles après / _ . : (chemins, identifiants) : jamais au milieu d’un mot.
            escaped = re.sub(r"([/_.:])(?=\S)", r"\1<wbr>", html.escape(content, quote=False))
            # Un code court (« x = 8 », « /mf open <id> ») ne se coupe pas sur ses espaces.
            short = ' class="nowrap"' if " " in content and len(content) <= 24 else ""
            return stash(f"<code{short}>{escaped}</code>")

        # Un paragraphe garde ses retours à la ligne : code, gras et italique peuvent les chevaucher (re.S).
        text = re.sub(r"(`+)(.+?)\1", code, text, flags=re.S)
        text = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|<>])", lambda m: stash(html.escape(m.group(1))), text)
        text = re.sub(
            r"<(https?://[^>\s]+)>",
            lambda m: stash(f'<a href="{html.escape(m.group(1))}">{html.escape(m.group(1))}</a>'),
            text,
        )
        text = re.sub(r"</?(?:br|kbd|sup|sub)\s*/?>", lambda m: stash(m.group(0)), text)
        text = html.escape(text, quote=False)

        def image(match: re.Match) -> str:
            alt, src = html.unescape(match.group(1)), html.unescape(match.group(2))
            url, size = self.image(alt, src)
            return stash(f'<img src="{html.escape(url)}" alt="{html.escape(alt)}"{size} loading="lazy">')

        text = re.sub(r'!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)', image, text)

        def link(match: re.Match) -> str:
            href = html.unescape(match.group(2))
            url = self.resolve(href)
            label = match.group(1)
            # Sur le site, un renvoi écrit `ai.md` se lit mieux sous le titre de la page visée.
            only_code = re.fullmatch("\x00(\\d+)\x00", label)
            target = self.target_page(href)
            if target and only_code and re.fullmatch(r"<code[^>]*>(?:[^<]|<wbr>)*\.(?:<wbr>)?md</code>", slots[int(only_code.group(1))]):
                label = html.escape(target.label)
            return stash(f'<a href="{html.escape(url)}">') + label + stash("</a>")

        text = re.sub(r'\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)', link, text)
        text = re.sub(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", r"<strong>\1</strong>", text, flags=re.S)
        text = re.sub(r"(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])", r"<em>\1</em>", text, flags=re.S)
        text = re.sub(r" {2,}\n", "<br>\n", text)
        while "\x00" in text:
            text = re.sub("\x00(\\d+)\x00", lambda m: slots[int(m.group(1))], text)
        return text

    # --- blocs ---

    def starts_block(self, lines: list[str], index: int) -> bool:
        line = lines[index]
        if HEADING.match(line) or FENCE.match(line) or RULE.match(line) or line.lstrip().startswith(">"):
            return True
        item = LIST_ITEM.match(line)
        if item and (not item.group(2)[0].isdigit() or item.group(2)[:-1] == "1"):
            return True
        return self.is_table(lines, index)

    @staticmethod
    def is_table(lines: list[str], index: int) -> bool:
        return (
            lines[index].lstrip().startswith("|")
            and index + 1 < len(lines)
            and bool(TABLE_SEPARATOR.match(lines[index + 1]))
        )

    @staticmethod
    def cells(line: str) -> list[str]:
        line = line.strip()
        if line.startswith("|"):
            line = line[1:]
        if line.endswith("|") and not line.endswith("\\|"):
            line = line[:-1]
        return [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", line)]

    def table(self, rows: list[str]) -> str:
        head = self.cells(rows[0])
        aligns = []
        for cell in self.cells(rows[1]):
            left, right = cell.startswith(":"), cell.endswith(":")
            aligns.append("center" if left and right else "right" if right else "")
        def cell_tag(tag: str, content: str, column: int) -> str:
            align = aligns[column] if column < len(aligns) else ""
            style = f' style="text-align:{align}"' if align else ""
            scope = ' scope="col"' if tag == "th" else ""
            return f"<{tag}{scope}{style}>{self.inline(content)}</{tag}>"
        out = ['<div class="table-wrap"><table class="doc-table"><thead><tr>']
        out += [cell_tag("th", cell, column) for column, cell in enumerate(head)]
        out.append("</tr></thead><tbody>")
        for row in rows[2:]:
            values = self.cells(row)
            values += [""] * (len(head) - len(values))
            out.append("<tr>" + "".join(cell_tag("td", cell, column) for column, cell in enumerate(values[: len(head)])) + "</tr>")
        out.append("</tbody></table></div>")
        return "".join(out)

    def paragraph(self, lines: list[str], tight: bool) -> str:
        text = "\n".join(line.strip() for line in lines)
        figure = IMAGE_ONLY.match(text)
        if figure and not tight:
            alt, src = figure.group(1), figure.group(2)
            url, size = self.image(alt, src)
            self.page.has_figures = True
            caption = self.inline(alt)
            return (
                f'<figure class="doc-figure"><a class="shot doc-shot" href="{html.escape(url)}">'
                f'<span class="shot-media"><img src="{html.escape(url)}" alt="{html.escape(alt)}"{size} loading="lazy"></span>'
                f'<span class="shot-caption" aria-hidden="true">{caption}</span></a></figure>'
            )
        content = self.inline(text)
        return content if tight else f"<p>{content}</p>"

    def blocks(self, lines: list[str], tight: bool = False) -> str:
        out: list[str] = []
        index = 0
        while index < len(lines):
            line = lines[index]
            if not line.strip():
                index += 1
                continue

            fence = FENCE.match(line)
            if fence:
                indent, marker, lang = len(fence.group(1)), fence.group(2), fence.group(3)
                code: list[str] = []
                index += 1
                while index < len(lines) and not (
                    lines[index].strip().startswith(marker[0] * len(marker)) and set(lines[index].strip()) == {marker[0]}
                ):
                    current = lines[index]
                    code.append(current[min(indent, indent_of(current)):])
                    index += 1
                index += 1
                kind = f' class="language-{lang}"' if lang else ""
                block = "diagram" if not lang else "code"
                out.append(f'<pre class="doc-code {block}"><code{kind}>{html.escape(chr(10).join(code), quote=False)}</code></pre>')
                continue

            heading = HEADING.match(line)
            if heading:
                level = len(heading.group(1))
                content = self.inline(heading.group(2))
                anchor = self.heading_id(plain(content))
                if level == 1 and not self.page.headings:
                    self.page.title = plain(content)
                self.page.headings.append((level, anchor, content))
                out.append(f'<h{level} id="{anchor}">{content}</h{level}>')
                index += 1
                continue

            if RULE.match(line):
                out.append("<hr>")
                index += 1
                continue

            if self.is_table(lines, index):
                rows = []
                while index < len(lines) and lines[index].strip().startswith("|"):
                    rows.append(lines[index])
                    index += 1
                out.append(self.table(rows))
                continue

            if line.lstrip().startswith(">"):
                quoted = []
                while index < len(lines) and lines[index].lstrip().startswith(">"):
                    quoted.append(re.sub(r"^\s*> ?", "", lines[index]))
                    index += 1
                out.append(f"<blockquote>{self.blocks(quoted)}</blockquote>")
                continue

            if HTML_BLOCK.match(line):
                raw = []
                while index < len(lines) and lines[index].strip():
                    raw.append(lines[index])
                    index += 1
                out.append("\n".join(raw))
                continue

            item = LIST_ITEM.match(line)
            if item:
                html_list, index = self.list_block(lines, index)
                out.append(html_list)
                continue

            paragraph = [line]
            index += 1
            while index < len(lines) and lines[index].strip() and not self.starts_block(lines, index):
                paragraph.append(lines[index])
                index += 1
            out.append(self.paragraph(paragraph, tight))
        return "\n".join(out)

    def list_block(self, lines: list[str], index: int) -> tuple[str, int]:
        first = LIST_ITEM.match(lines[index])
        base = len(first.group(1))
        ordered = first.group(2)[0].isdigit()
        start = int(first.group(2)[:-1]) if ordered else 1
        items: list[list[str]] = []
        loose = False
        while index < len(lines):
            match = LIST_ITEM.match(lines[index])
            if not match or len(match.group(1)) != base or match.group(2)[0].isdigit() != ordered:
                break
            content_indent = len(match.group(1)) + len(match.group(2)) + len(match.group(3))
            body = [match.group(4)]
            index += 1
            while index < len(lines):
                current = lines[index]
                if not current.strip():
                    following = index
                    while following < len(lines) and not lines[following].strip():
                        following += 1
                    if following < len(lines) and indent_of(lines[following]) >= content_indent:
                        body.extend([""] * (following - index))
                        index = following
                        loose = True
                        continue
                    break
                if indent_of(current) >= content_indent:
                    body.append(current[content_indent:])
                    index += 1
                    continue
                if LIST_ITEM.match(current) or self.starts_block(lines, index):
                    break
                body.append(current.strip())
                index += 1
            items.append(body)
            following = index
            while following < len(lines) and not lines[following].strip():
                following += 1
            next_item = LIST_ITEM.match(lines[following]) if following < len(lines) else None
            if next_item and len(next_item.group(1)) == base and next_item.group(2)[0].isdigit() == ordered:
                if following > index:
                    loose = True
                index = following
            else:
                break
        tag = "ol" if ordered else "ul"
        start_attribute = f' start="{start}"' if ordered and start != 1 else ""
        rendered = "".join(f"<li>{self.blocks(body, tight=not loose)}</li>" for body in items)
        return f"<{tag}{start_attribute}>{rendered}</{tag}>", index


# ---------------------------------------------------------------------------
# Gabarit des pages de documentation
# ---------------------------------------------------------------------------


def describe(page: Page, body: str) -> str:
    match = re.search(r"<p>(.*?)</p>", body, re.S)
    text = re.sub(r"\s+", " ", plain(match.group(1) if match else page.title)).strip()
    if len(text) > 160:
        text = text[:157].rsplit(" ", 1)[0] + "…"
    return text


def doc_menu(page: Page, pages: dict[str, Page]) -> str:
    text = TEXT[page.lang]
    groups = []
    for title, names in DOC_GROUPS:
        links = []
        for name in names:
            target = pages[name]
            current = ' aria-current="page"' if target is page else ""
            links.append(f'<li><a href="{relative(target.out_path, page.out_path.parent)}"{current}>{html.escape(target.label)}</a></li>')
        groups.append(f'<p class="doc-group">{html.escape(title)}</p><ul>{"".join(links)}</ul>')
    return (
        f'<aside class="doc-sidebar" aria-label="{text["menu"]}"><details class="doc-menu" open>'
        f'<summary>{text["menu"]}</summary>{"".join(groups)}</details></aside>'
    )


def doc_toc(page: Page) -> str:
    sections = [(anchor, content) for level, anchor, content in page.headings if level == 2]
    if len(sections) < 4:
        return ""
    items = "".join(f'<li><a href="#{anchor}">{re.sub(r"<a [^>]*>|</a>", "", content)}</a></li>' for anchor, content in sections)
    # Liste sans numéros : beaucoup de titres portent déjà le leur (« 1. Installer… »).
    return f'<nav class="doc-toc" aria-label="{TEXT[page.lang]["toc"]}"><p>{TEXT[page.lang]["toc"]}</p><ul>{items}</ul></nav>'


def doc_pager(page: Page, pages: dict[str, Page]) -> str:
    order = [name for _, names in DOC_GROUPS for name in names]
    if page.name not in order:
        return ""
    position = order.index(page.name)
    text = TEXT[page.lang]
    parts = []
    if position > 0:
        target = pages[order[position - 1]]
        parts.append(
            f'<a class="doc-pager-link previous" href="{relative(target.out_path, page.out_path.parent)}">'
            f'<span class="doc-pager-hint"><svg class="icon" aria-hidden="true"><use href="#i-chevron-left"></use></svg>{text["previous"]}</span>'
            f"<strong>{html.escape(target.label)}</strong></a>"
        )
    if position + 1 < len(order):
        target = pages[order[position + 1]]
        parts.append(
            f'<a class="doc-pager-link next" href="{relative(target.out_path, page.out_path.parent)}">'
            f'<span class="doc-pager-hint">{text["next"]}<svg class="icon" aria-hidden="true"><use href="#i-chevron-right"></use></svg></span>'
            f"<strong>{html.escape(target.label)}</strong></a>"
        )
    return f'<nav class="doc-pager" aria-label="{text["docs"]}">{"".join(parts)}</nav>'


def viewer(lang: str) -> str:
    text = TEXT[lang]
    return f"""<dialog id="viewer" class="viewer" aria-label="{text["viewer"]}">
  <div class="viewer-frame">
    <img class="viewer-image" alt="">
    <div class="viewer-bar">
      <button class="button icon-only" type="button" data-action="previous" aria-label="{text["viewer_previous"]}">
        <svg class="icon" aria-hidden="true"><use href="#i-chevron-left"></use></svg>
      </button>
      <p class="viewer-caption tip"></p>
      <button class="button icon-only" type="button" data-action="next" aria-label="{text["viewer_next"]}">
        <svg class="icon" aria-hidden="true"><use href="#i-chevron-right"></use></svg>
      </button>
      <button class="button icon-only" type="button" data-action="close" aria-label="{text["viewer_close"]}">
        <svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg>
      </button>
    </div>
  </div>
</dialog>
"""


def doc_html(page: Page, body: str, pages: dict[str, Page], icons: str) -> str:
    lang = page.lang
    text = TEXT[lang]
    base = page.out_path.parent
    assets = relative(SITE_DIR / "assets", base)
    home = relative(SITE_DIR, base) + "/"
    docs_index = relative((DOCS_OUT_EN if lang == "en" else DOCS_OUT) / "index.html", base)
    fr_index, en_index = DOCS_OUT / "index.html", DOCS_OUT_EN / "index.html"
    if lang == "fr":
        switch = (
            f'<a href="{relative(fr_index, base)}" hreflang="fr" lang="fr" aria-current="page" aria-label="Français">FR</a>'
            f'<a href="{relative(en_index, base)}" hreflang="en" lang="en" aria-label="English" data-tip="Documentation index in English">EN</a>'
        )
        nav_items = [
            (home, text["home"], False),
            (docs_index, text["docs"], page.name == "index"),
            (relative(DOCS_OUT / "guide.html", base), text["guide"], page.name == "guide"),
            (relative(DOCS_OUT / "shortcuts.html", base), text["shortcuts"], page.name == "shortcuts"),
        ]
        canonical = f"{SITE_URL}/{relative(page.out_path, SITE_DIR)}"
        alternate = (
            f'<link rel="alternate" hreflang="fr" href="{SITE_URL}/docs/">\n'
            f'  <link rel="alternate" hreflang="en" href="{SITE_URL}/en/docs/">'
            if page.name == "index"
            else ""
        )
        sidebar = doc_menu(page, pages)
        layout = "doc-layout"
    else:
        switch = (
            f'<a href="{relative(fr_index, base)}" hreflang="fr" lang="fr" aria-label="Français" data-tip="Sommaire en français">FR</a>'
            f'<a href="{relative(en_index, base)}" hreflang="en" lang="en" aria-current="page" aria-label="English">EN</a>'
        )
        nav_items = [
            (home, text["home"], False),
            (docs_index, text["docs"], True),
            (relative(DOCS_OUT / "guide.html", base), text["guide"], False),
            (relative(DOCS_OUT / "shortcuts.html", base), text["shortcuts"], False),
        ]
        canonical = f"{SITE_URL}/en/docs/"
        alternate = (
            f'<link rel="alternate" hreflang="fr" href="{SITE_URL}/docs/">\n'
            f'  <link rel="alternate" hreflang="en" href="{SITE_URL}/en/docs/">'
        )
        sidebar = ""
        layout = "doc-layout single"
    nav_parts = []
    for position, (href, label, current) in enumerate(nav_items):
        attributes = ' aria-current="page"' if current else ""
        # Depuis l’index anglais, le guide et les raccourcis sont des pages en français.
        if lang == "en" and position > 1:
            attributes += ' hreflang="fr"'
        nav_parts.append(f'<li><a href="{href}"{attributes}>{label}</a></li>')
    nav = "".join(nav_parts)
    title = f"{page.title} – {text['title_suffix']}" if page.name != "index" else text["title_suffix"]
    source = ""
    if page.source:
        source = (
            f'<p class="doc-source">{text["source"]}&nbsp;: <a href="{GITHUB}/blob/main/{page.source}"><code>{page.source}</code></a>'
            f' · <a href="{GITHUB}/edit/main/{page.source}">{text["edit"]}</a></p>'
        )
    pager = doc_pager(page, pages) if lang == "fr" else ""
    return f"""<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(page.description)}">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#111216">
  <link rel="canonical" href="{canonical}">
  {alternate}
  <link rel="icon" href="{assets}/logo.svg" type="image/svg+xml">
  <link rel="preload" href="{assets}/fonts/pixelify-sans-600.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="{assets}/fonts/atkinson-hyperlegible-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="{assets}/site.css">
  <script src="{assets}/site.js" defer></script>
</head>
<body class="doc-page">
<!-- Page générée par site/scripts/build.py depuis {page.source} : ne pas la modifier à la main. -->
{icons}
<a class="skip-link" href="#contenu">{text["skip"]}</a>

<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="{home}">
      <img src="{assets}/logo.svg" alt="" width="36" height="36">
      <span>Menu Forge</span>
    </a>
    <nav class="nav" aria-label="{text["nav"]}">
      <ul>{nav}</ul>
    </nav>
    <div class="topbar-end">
      <nav class="lang-switch" aria-label="{text["language"]}">{switch}</nav>
      <a class="button icon-only" href="{GITHUB}" aria-label="{text["github"]}" data-tip="{text["github"]}">
        <svg class="icon" aria-hidden="true"><use href="#i-github"></use></svg>
      </a>
    </div>
  </div>
</header>

<main id="contenu" class="doc-main">
  <div class="wrap {layout}">
    {sidebar}
    <article class="doc-article">
{body}
{source}
{pager}
    </article>
  </div>
</main>

<footer class="footer">
  <div class="wrap footer-inner">
    <a class="brand" href="{home}">
      <img src="{assets}/logo.svg" alt="" width="24" height="24">
      <span>Menu Forge</span>
    </a>
    <p>{text["footer"]}</p>
    <a href="{GITHUB}">github.com/pedrokarim/menu-forge</a>
  </div>
</footer>
{viewer(lang) if page.has_figures else ""}</body>
</html>
"""


def insert_toc(page: Page, body: str) -> str:
    """Le sommaire de la page, juste après le premier paragraphe qui suit le titre."""
    toc = doc_toc(page)
    if not toc:
        return body
    match = re.search(r"</h1>\s*(<p>.*?</p>)?", body, re.S)
    if not match:
        return toc + body
    return body[: match.end()] + "\n" + toc + body[match.end():]


def build_docs() -> list[Page]:
    pages = {name: Page(name, source, label, DOCS_OUT / f"{name}.html", "fr") for name, source, label in DOC_PAGES}
    by_source = {page.source: page for page in pages.values()}
    grouped = [name for _, names in DOC_GROUPS for name in names]
    if sorted(grouped) != sorted(pages):
        raise BuildError("DOC_GROUPS et DOC_PAGES ne listent pas les mêmes pages")
    english = Page("index", EN_INDEX, "Documentation", DOCS_OUT_EN / "index.html", "en")
    icons = doc_sprite()

    for directory in (DOCS_OUT, DOCS_OUT_EN):
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir(parents=True)
    for file in DOC_FILES:
        shutil.copyfile(REPO_DIR / file, DOCS_OUT / Path(file).name)

    rendered = []
    for page in [*pages.values(), english]:
        markdown = (REPO_DIR / page.source).read_text(encoding="utf-8")
        body = Renderer(page, by_source).blocks(markdown.replace("\r\n", "\n").split("\n"))
        if not page.headings or page.headings[0][0] != 1:
            fail(f"{page.source} : la page doit commencer par un titre de niveau 1")
            continue
        page.description = describe(page, body)
        rendered.append((page, insert_toc(page, body)))
    for page, body in rendered:
        page.html = doc_html(page, body, pages, icons)
        page.out_path.write_text(page.html, encoding="utf-8", newline="\n")
    print(f"documentation : {len(rendered)} pages dans {relative(DOCS_OUT, REPO_DIR)}/ et {relative(DOCS_OUT_EN, REPO_DIR)}/")
    return [page for page, _ in rendered]


# ---------------------------------------------------------------------------
# Pages d’accueil
# ---------------------------------------------------------------------------


def fix_dimensions(html_text: str, page_dir: Path) -> str:
    def replace(match: re.Match) -> str:
        tag = match.group(0)
        source = re.search(r'src="((?:\.\./)?assets/screens/[^"]+\.png)"', tag).group(1)
        path = (page_dir / source).resolve()
        if not path.exists():
            fail(f"{relative(page_dir, SITE_DIR) or '.'} : capture absente : {source}")
            return tag
        width, height = png_size(path)
        tag = re.sub(r'width="\d+"', f'width="{width}"', tag)
        return re.sub(r'height="\d+"', f'height="{height}"', tag)

    return re.sub(r'<img\b[^>]*src="(?:\.\./)?assets/screens/[^"]+"[^>]*>', replace, html_text, flags=re.S)


def build_home(page: Path, with_sprite: bool) -> None:
    html_text = page.read_text(encoding="utf-8")
    if with_sprite:
        names = sorted(set(re.findall(r'href="#i-([a-z0-9-]+)"', html_text)))
        html_text = re.sub(
            r"<!-- ICONS -->.*?<!-- /ICONS -->",
            lambda _: f"<!-- ICONS -->{sprite(names)}<!-- /ICONS -->",
            html_text,
            flags=re.S,
        )
    html_text = fix_dimensions(html_text, page.parent)
    page.write_text(html_text, encoding="utf-8", newline="\n")
    print(f"{relative(page, SITE_DIR)} : {'sprite et ' if with_sprite else ''}dimensions des captures à jour")


# ---------------------------------------------------------------------------
# Vérification des liens
# ---------------------------------------------------------------------------


def ids_of(html_text: str) -> set[str]:
    return {html.unescape(value) for value in re.findall(r'\sid="([^"]+)"', html_text)}


def check_links(doc_pages: list[Page]) -> None:
    generated = {page.out_path.resolve(): page.html for page in doc_pages}
    cache: dict[Path, set[str]] = {}

    def anchors(path: Path) -> set[str]:
        path = path.resolve()
        if path not in cache:
            source = generated.get(path)
            if source is None:
                source = path.read_text(encoding="utf-8") if path.exists() else ""
            cache[path] = ids_of(source)
        return cache[path]

    def target_file(base: Path, href: str) -> Path:
        path = Path(os.path.normpath(base / href))
        if href.endswith("/") or path.is_dir():
            path = path / "index.html"
        return path

    # Liens des pages de documentation (relevés pendant le rendu, vers les pages générées).
    for page in doc_pages:
        for href, out, anchor in page.links:
            if anchor and html.unescape(anchor) not in anchors(out):
                fail(f"{page.source} : ancre introuvable : {href}")

    # Liens relatifs de toutes les pages publiées (accueil et documentation).
    published = [(path, path.read_text(encoding="utf-8")) for path in HOME_PAGES]
    published += [(page.out_path, page.html) for page in doc_pages]
    for path, source in published:
        for attribute, value in re.findall(r'\s(href|src)="([^"]+)"', source):
            value = html.unescape(value)
            if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", value) or value.startswith("//") or value.startswith("#i-"):
                continue
            file_part, _, anchor = value.partition("#")
            target = target_file(path.parent, file_part) if file_part else path
            if file_part and not (target.resolve() in generated or target.exists()):
                fail(f"{relative(path, SITE_DIR)} : lien mort : {value}")
                continue
            if anchor and anchor not in anchors(target):
                fail(f"{relative(path, SITE_DIR)} : ancre introuvable : {value}")


def main() -> None:
    docs_only = "--docs" in sys.argv[1:]
    try:
        for page in HOME_PAGES:
            build_home(page, with_sprite=not docs_only)
        doc_pages = build_docs()
        check_links(doc_pages)
    except BuildError as error:
        fail(str(error))
    if errors:
        print(f"\n{len(errors)} erreur(s) :", file=sys.stderr)
        for message in errors:
            print(f"  {message}", file=sys.stderr)
        sys.exit(1)
    print("liens et ancres vérifiés, aucune erreur")


if __name__ == "__main__":
    main()

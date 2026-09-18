"""Assemble the editable frontend into one page, without browser-side includes."""
from pathlib import Path
import re

WEBSITE_ROOT = Path(__file__).resolve().parents[1] / "website"
VIEW = re.compile(r'<template data-view="([^"]+)"></template>')
SCRIPT = re.compile(r'<script src="([^"?]+)(?:\?[^"]*)?" type="text/plain" data-app-script></script>')
STYLE = re.compile(r'<link rel="stylesheet" href="(styles\.css)(?:\?[^"]*)?" />')


def render_page(root: Path = WEBSITE_ROOT) -> str:
    root = root.resolve()

    def read(name: str) -> str:
        path = (root / name).resolve()
        if not path.is_relative_to(root):
            raise ValueError("Frontend includes must stay inside the website directory")
        return path.read_text(encoding="utf-8")

    page = VIEW.sub(lambda match: read(match[1]), read("shell.html"))
    page = STYLE.sub(lambda match: '<style data-source="styles.css">\n' + read(match[1]) + '\n</style>', page)

    def inline_script(match: re.Match) -> str:
        source = read(match[1])
        # Do not let a JS string/comment accidentally close its HTML script element.
        source = re.sub(r"</script", r"<\\/script", source, flags=re.IGNORECASE)
        return f'<script data-app-source="{match[1]}">\n{source}\n</script>'

    page = SCRIPT.sub(inline_script, page)
    return "<!-- Generated page. Edit website/shell.html, views/, js/, and styles.css. -->\n" + page


def write_page(root: Path = WEBSITE_ROOT) -> Path:
    """Atomically replace the static page, retaining the old page if assembly fails."""
    page = render_page(root)
    target = root / "index.html"
    temporary = root / ".index.html.tmp"
    temporary.write_text(page, encoding="utf-8")
    temporary.replace(target)
    return target

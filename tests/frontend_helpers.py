"""Read the same local view files and script order as the browser loader."""
import re
from pathlib import Path

WEBSITE = Path(__file__).resolve().parents[1] / "website"


def assembled_chat_html():
    return (WEBSITE / "index.html").read_text(encoding="utf-8")


def application_scripts(html):
    return re.findall(r'<script data-app-source="([^"]+)"', html)

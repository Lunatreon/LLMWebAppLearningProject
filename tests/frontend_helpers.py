"""Compose view markup only for assertions; production loads views in the browser."""
import json
import re
from pathlib import Path

WEBSITE = Path(__file__).resolve().parents[1] / "website"


def assembled_chat_html():
    html = (WEBSITE / "index.html").read_text(encoding="utf-8")
    return re.sub(
        r'<template data-view="([^"]+)"></template>',
        lambda match: (WEBSITE / match[1]).read_text(encoding="utf-8"),
        html,
    )


def application_scripts(html):
    loader = (WEBSITE / "js/load-views.js").read_text(encoding="utf-8")
    manifest = re.search(r"const APP_SCRIPTS = (\[[\s\S]*?\]);", loader)
    return json.loads(manifest[1])

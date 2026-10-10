"""Publish a finished HTML AGB version and configure mandatory acceptance locally.

Review and finish website/legal/agb-draft.html first. This command never uploads
files or restarts the backend. Existing version files are never overwritten.
"""
import argparse
import hashlib
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def publish(document: Path, version: str, public_url: str, root: Path = ROOT, *, allow_draft: bool = False):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}", version):
        raise ValueError("Use a version such as 2026-10-04-v1 (letters, digits, dash, underscore).")
    url = urlsplit(public_url)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("Public website URL must be HTTPS without credentials, query or fragment.")
    data = document.read_bytes()
    content = data.decode("utf-8")
    if allow_draft and not version.startswith("test-"):
        raise ValueError("Draft publication requires a test- version prefix.")
    if not allow_draft and any(marker in content for marker in ("ENTWURF", "PLATZHALTER", "[PLZ", "[Link", "[Veröffentlichungsdatum")):
        raise ValueError("Finish and review the placeholder document before publishing.")
    if "<html" not in content.lower():
        raise ValueError("Provide a UTF-8 HTML document.")
    destination = root / "website" / "legal" / "agb" / f"{version}.html"
    document_url = f"{public_url.rstrip('/')}/legal/agb/{version}.html"
    if len(document_url) > 2048:
        raise ValueError("Document URL is too long.")
    digest = hashlib.sha256(data).hexdigest()
    env = root / ".env"
    config = env.read_text(encoding="utf-8") if env.exists() else ""
    for key, value in {"TERMS_VERSION": version, "TERMS_DOCUMENT_URL": document_url,
                       "TERMS_DOCUMENT_SHA256": digest}.items():
        pattern = rf"(?m)^{key}=.*$"
        line = f'{key}="{value}"'
        config = re.sub(pattern, lambda _: line, config) if re.search(pattern, config) else config.rstrip()+"\n"+line+"\n"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("xb") as output:
        output.write(data)
    env.write_text(config, encoding="utf-8")
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document", type=Path, default=ROOT / "website/legal/agb-draft.html")
    parser.add_argument("--version", required=True)
    parser.add_argument("--public-url", default="https://app.feel-y.com")
    parser.add_argument("--allow-draft", action="store_true", help="Explicitly publish unfinished terms for testing only; requires a test- version.")
    args = parser.parse_args()
    try:
        result = publish(args.document, args.version, args.public_url, allow_draft=args.allow_draft)
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Cannot publish terms: {exc}\n")
    print(f"Published {result}. Serve this file, then restart the backend to enforce acceptance.")


if __name__ == "__main__":
    main()

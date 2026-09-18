"""Create the standalone frontend page for any static HTTP server."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.frontend import WEBSITE_ROOT, render_page, write_page


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        if (WEBSITE_ROOT / "index.html").read_text(encoding="utf-8") != render_page():
            parser.exit(1, "Run python scripts/build_frontend.py to update the standalone page.\n")
        print("Standalone frontend is up to date.")
    else:
        print(f"Built {write_page()}")


if __name__ == "__main__":
    main()

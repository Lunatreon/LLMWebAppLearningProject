"""Deploy the mail bridge using an already authenticated Cloudflare Wrangler CLI."""
import os
from pathlib import Path
import shutil
import re
import subprocess
import sys
import tomllib

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "cloudflare" / "webmail"


def main():
    npx = shutil.which("npx.cmd") or shutil.which("npx")
    if not npx:
        raise SystemExit("Install Node.js with npm before deploying the Cloudflare Worker.")
    values = dotenv_values(ROOT / ".env")
    secret = values.get("WEBMAIL_BRIDGE_SECRET", "")
    if len(secret) < 32:
        raise SystemExit("Run scripts/init_webmail.py first.")
    config = tomllib.loads((WORKER / "wrangler.toml").read_text())
    if config["vars"]["MAILBOX_ADDRESS"] != values.get("WEBMAIL_ADDRESS"):
        raise SystemExit("Match MAILBOX_ADDRESS in wrangler.toml to WEBMAIL_ADDRESS before deployment.")
    command = [npx, "--yes", "wrangler@4.147.0"]
    environment = os.environ.copy()
    environment["NO_COLOR"] = "1"
    if config.get("account_id"):
        environment["CLOUDFLARE_ACCOUNT_ID"] = config["account_id"]
    def run(*args, **kwargs):
        return subprocess.run(command + list(args), cwd=WORKER, env=environment, check=True, **kwargs)
    # Refuse unattended login flows. Complete `wrangler login` first.
    identity = run("whoami", capture_output=True, text=True, encoding="utf-8")
    if "not authenticated" in identity.stdout:
        raise SystemExit("Run npx --yes wrangler@4.147.0 login first.")
    bucket = config["r2_buckets"][0]["bucket_name"]
    result = run("r2", "bucket", "list", capture_output=True, text=True, encoding="utf-8")
    buckets = re.findall(r"(?m)^name:\s*(\S+)", result.stdout)
    if bucket not in buckets:
        run("r2", "bucket", "create", bucket)
    run("deploy")
    # stdin keeps the bridge credential out of command arguments and console output.
    run("secret", "put", "BRIDGE_SECRET", input=secret + "\n", text=True)
    print("Set worker_url in webmail.init.toml to the deployed HTTPS URL, rerun init_webmail.py, and restart FeelY.")
    print("In Cloudflare Email Routing, route your mailbox address to the deployed Worker.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        if exc.stderr:
            print(exc.stderr, file=sys.stderr)
        sys.exit("Cloudflare deployment did not complete. Check account access and R2 activation; rerun after fixing.")

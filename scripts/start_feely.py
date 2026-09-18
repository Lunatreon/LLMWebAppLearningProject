"""Start FeelY's local servers and existing Cloudflare tunnel on Windows."""

import argparse
from contextlib import ExitStack
from datetime import datetime
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser


ROOT = Path(__file__).resolve().parents[1]
ANSI_COLOR = re.compile(r"\x1b\[[0-9;]*m")
SERVICE_COLORS = {"backend": "36", "website": "32", "tunnel": "35"}


def stream_logs(name, pipe, log, color=False):
    """Mirror each service's output to its log file and the launcher console."""
    with pipe:
        for line in pipe:
            log.write(ANSI_COLOR.sub("", line))
            log.flush()
            label = f"[{name}]"
            if color:
                label = f"\033[{SERVICE_COLORS[name]}m{label}\033[0m"
            print(f"{label} {line}", end="", flush=True)


def port_open(port):
    with socket.socket() as connection:
        connection.settimeout(0.3)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check prerequisites without starting services")
    parser.add_argument("--color", action="store_true", help="Enable colored service labels and backend logs")
    parser.add_argument("--no-browser", action="store_true", help="Start services without opening a browser")
    args = parser.parse_args()
    processes = []
    readers = []
    try:
        cloudflared = shutil.which("cloudflared") or str(
            Path(os.environ.get("ProgramFiles", "C:/Program Files"))
            / "cloudflared" / "cloudflared.exe"
        )
        config = ROOT / "scripts" / "cloudflared-public.yml"
        for path in (Path(cloudflared), config, ROOT / ".env", ROOT / "website" / "index.html"):
            if not path.exists():
                raise RuntimeError(f"Missing {path}. See README.md and scripts/CLOUDFLARED_README.md.")
        subprocess.run([sys.executable, "-c", "import uvicorn; import fastapi"], check=True, cwd=ROOT)
        # Cloudflared validates routing locally; this does not connect the tunnel.
        subprocess.run([cloudflared, "tunnel", "--config", str(config), "ingress", "validate"], check=True, cwd=ROOT)
        for line in config.read_text().splitlines():
            if line.startswith("credentials-file:"):
                credentials = Path(line.split(":", 1)[1].strip().strip("\"'"))
                if not credentials.is_file():
                    raise RuntimeError(f"Tunnel credentials missing: {credentials}")
        for port in (8000, 5500):
            if port_open(port):
                raise RuntimeError(f"Port {port} is already in use. Stop the existing server before starting FeelY.")
        subprocess.run([sys.executable, str(ROOT / "scripts" / "build_frontend.py")], check=True, cwd=ROOT)
        if args.check:
            print("Startup checks passed. No services were started.")
            return 0

        logs = ROOT / "logs"
        logs.mkdir(exist_ok=True)
        with ExitStack() as stack:
            def start(name, command):
                log = stack.enter_context((logs / f"{name}.log").open("a", encoding="utf-8"))
                log.write(f"\n--- Starting {name} at {datetime.now().isoformat(timespec='seconds')} ---\n")
                log.flush()
                environment = os.environ.copy()
                environment.update(PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
                process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                           text=True, encoding="utf-8", errors="replace", bufsize=1,
                                           env=environment,
                                           creationflags=subprocess.CREATE_NO_WINDOW)
                processes.append((name, process))
                print(f"Starting {name}; log: {logs / (name + '.log')}", flush=True)
                reader = threading.Thread(target=stream_logs, args=(name, process.stdout, log, args.color))
                reader.start()
                readers.append(reader)
                return process

            try:
                for name, port, command in (
                    ("backend", 8000, [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]),
                    ("website", 5500, [sys.executable, "-m", "uvicorn", "app.website:app", "--host", "127.0.0.1", "--port", "5500"]),
                ):
                    command.extend(["--proxy-headers", "--forwarded-allow-ips", "127.0.0.1", "--no-server-header"])
                    if name == "backend" and args.color:
                        command.append("--use-colors")
                    process = start(name, command)
                    deadline = time.monotonic() + 90
                    while not port_open(port):
                        if process.poll() is not None or time.monotonic() >= deadline:
                            detail = (f"exit code {process.returncode}" if process.returncode is not None
                                      else "startup timed out after 90 seconds")
                            raise RuntimeError(f"{name} failed to start ({detail}). See logs/{name}.log.")
                        time.sleep(0.25)
                start("tunnel", [cloudflared, "tunnel", "--config", str(config), "run"])
                print("\nLocal website: http://127.0.0.1:5500\nPublic website: https://app.feel-y.com\n"
                      "Live logs below are labeled [backend], [website], and [tunnel].\n"
                      "Keep this window open. Press Ctrl+C to stop all three services.", flush=True)
                if not args.no_browser:
                    webbrowser.open("http://127.0.0.1:5500")
                while True:
                    for name, process in processes:
                        if process.poll() is not None:
                            raise RuntimeError(f"{name} stopped unexpectedly (exit code {process.returncode}). "
                                               f"See logs/{name}.log.")
                    time.sleep(1)
            finally:
                for _, process in reversed(processes):
                    if process.poll() is None:
                        process.terminate()
                for _, process in processes:
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                for reader in readers:
                    reader.join()
    except KeyboardInterrupt:
        print("\nFeelY stopped.")
        return 0
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        try:
            (ROOT / "logs").mkdir(exist_ok=True)
            with (ROOT / "logs" / "launcher.log").open("a", encoding="utf-8") as log:
                log.write(f"{datetime.now().isoformat(timespec='seconds')} {error}\n")
        except OSError:
            pass  # Still report the original failure if the log cannot be written.
        print(f"\nStartup failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

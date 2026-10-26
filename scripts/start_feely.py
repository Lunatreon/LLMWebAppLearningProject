"""Build React and run the native backend; PostgreSQL runs separately."""

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
SERVICE_COLORS = {"backend": "36", "tunnel": "35"}


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
    parser.add_argument(
        "--check", action="store_true", help="Check prerequisites without starting services"
    )
    parser.add_argument(
        "--color", action="store_true", help="Enable colored service labels and backend logs"
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="Start services without opening a browser"
    )
    parser.add_argument(
        "--tunnel", action="store_true", help="Also start the configured public Cloudflare tunnel"
    )
    args = parser.parse_args()
    processes = []
    readers = []
    try:
        cloudflared = shutil.which("cloudflared") or str(
            Path(os.environ.get("ProgramFiles", "C:/Program Files"))
            / "cloudflared"
            / "cloudflared.exe"
        )
        config = ROOT / "scripts" / "cloudflared-public.yml"
        for path in (ROOT / ".env", ROOT / "frontend-react" / "index.html"):
            if not path.exists():
                raise RuntimeError(f"Missing {path}. See README.md.")
        npm = shutil.which("npm.cmd") or shutil.which("npm")
        if not npm or not (ROOT / "frontend-react" / "node_modules").is_dir():
            raise RuntimeError("Install Node 24 and run npm ci in frontend-react first.")
        subprocess.run(
            [sys.executable, "-c", "import uvicorn; import fastapi"], check=True, cwd=ROOT
        )
        if args.tunnel:
            if not Path(cloudflared).is_file() or not config.is_file():
                raise RuntimeError("Cloudflare executable or tunnel configuration is missing.")
            subprocess.run(
                [cloudflared, "tunnel", "--config", str(config), "ingress", "validate"],
                check=True,
                cwd=ROOT,
            )
        if port_open(8000):
            raise RuntimeError("Port 8000 is already in use. Stop the existing backend first.")
        if args.check:
            print("Startup checks passed. No services were started.")
            return 0

        subprocess.run([npm, "run", "build"], check=True, cwd=ROOT / "frontend-react")
        logs = ROOT / "logs"
        logs.mkdir(exist_ok=True)
        with ExitStack() as stack:

            def start(name, command):
                log = stack.enter_context((logs / f"{name}.log").open("a", encoding="utf-8"))
                log.write(
                    f"\n--- Starting {name} at {datetime.now().isoformat(timespec='seconds')} ---\n"
                )
                log.flush()
                environment = os.environ.copy()
                environment.update(PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
                process = subprocess.Popen(
                    command,
                    cwd=ROOT,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                    env=environment,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                processes.append((name, process))
                print(f"Starting {name}; log: {logs / (name + '.log')}", flush=True)
                reader = threading.Thread(
                    target=stream_logs, args=(name, process.stdout, log, args.color)
                )
                reader.start()
                readers.append(reader)
                return process

            try:
                command = [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "backend.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                    "--no-server-header",
                ]
                if args.color:
                    command.append("--use-colors")
                process = start("backend", command)
                deadline = time.monotonic() + 90
                while not port_open(8000):
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError(
                            "Backend failed to start. Check PostgreSQL, migrations and logs/backend.log."
                        )
                    time.sleep(0.25)
                if args.tunnel:
                    start("tunnel", [cloudflared, "tunnel", "--config", str(config), "run"])
                print(
                    "\nFeelY: http://127.0.0.1:8000\nKeep this window open. Press Ctrl+C to stop.",
                    flush=True,
                )
                if not args.no_browser:
                    webbrowser.open("http://127.0.0.1:8000")
                while True:
                    for name, process in processes:
                        if process.poll() is not None:
                            raise RuntimeError(
                                f"{name} stopped unexpectedly (exit code {process.returncode}). "
                                f"See logs/{name}.log."
                            )
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

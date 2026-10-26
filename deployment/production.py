"""Validate one private production env file and emit a backend-only environment."""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from dotenv import dotenv_values
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from backend.core.config import Settings
from backend.core.production import configured

ROOT = Path(__file__).resolve().parents[1]


def load_production(path):
    if not path.is_file():
        raise RuntimeError("The private production master env file does not exist.")
    values = dict(dotenv_values(path, interpolate=False))
    defaults = {
        name: field.get_default(call_default_factory=True)
        for name, field in Settings.model_fields.items()
    }
    for name in defaults:
        raw = values.get(name.upper())
        if raw is not None:
            if name in {"allowed_hosts", "cors_origins", "content_encryption_keys"}:
                try:
                    defaults[name] = json.loads(raw)
                except ValueError:
                    raise RuntimeError(
                        f"{name.upper()} must be a JSON list of hostnames/origins."
                    ) from None
            else:
                defaults[name] = raw
    # Supplying every field prevents host environment variables filling absent credentials.
    config = Settings(_env_file=None, **defaults)
    if config.is_local_environment:
        raise RuntimeError("ENVIRONMENT must be production for this command.")
    config.validate_runtime_security()
    validate_deployment_values(config, values)
    return config, values


def validate_deployment_values(config, values):
    for name in ("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_APP_USER"):
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", values.get(name, "")):
            raise RuntimeError(f"{name} must be an explicit lowercase PostgreSQL identifier.")
    if values["POSTGRES_APP_USER"] in {"postgres", values["POSTGRES_USER"]}:
        raise RuntimeError("POSTGRES_APP_USER must differ from the bootstrap administrator.")
    for name in ("POSTGRES_PASSWORD", "POSTGRES_APP_PASSWORD"):
        if not configured(values.get(name)) or len(values[name]) < 32:
            raise RuntimeError(
                f"{name} must be a separate random secret of at least 32 characters."
            )
    if values["POSTGRES_PASSWORD"] == values["POSTGRES_APP_PASSWORD"]:
        raise RuntimeError("Use different bootstrap and application database passwords.")
    database = make_url(config.database_url)
    if (
        database.host != "postgres"
        or database.database != values["POSTGRES_DB"]
        or database.username != values["POSTGRES_APP_USER"]
        or database.password != values["POSTGRES_APP_PASSWORD"]
    ):
        raise RuntimeError(
            "DATABASE_URL must match the application role/password/database at postgres:5432."
        )
    if database.port not in (None, 5432):
        raise RuntimeError("DATABASE_URL must use the internal PostgreSQL port 5432.")
    domain = values.get("INGRESS_DOMAIN", "")
    if not configured(domain) or not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", domain):
        raise RuntimeError("INGRESS_DOMAIN must be a public DNS hostname without scheme or port.")
    if domain not in config.allowed_hosts:
        raise RuntimeError("ALLOWED_HOSTS must include INGRESS_DOMAIN.")
    if not configured(values.get("ACME_EMAIL")) or "@" not in values["ACME_EMAIL"]:
        raise RuntimeError("ACME_EMAIL must identify the certificate contact mailbox.")
    try:
        network = ipaddress.ip_network(values.get("FEELY_PROXY_SUBNET", ""))
        proxy = ipaddress.ip_address(values.get("FEELY_PROXY_IP", ""))
        backend = ipaddress.ip_address(values.get("FEELY_BACKEND_IP", ""))
        if network.version != 4 or not network.is_private or proxy not in network:
            raise ValueError
        if proxy in (
            network.network_address,
            network.broadcast_address,
            network.network_address + 1,
        ):
            raise ValueError
        if (
            backend not in network
            or backend == proxy
            or backend
            in (network.network_address, network.broadcast_address, network.network_address + 1)
        ):
            raise ValueError
    except ValueError:
        raise RuntimeError(
            "Configure a private IPv4 FEELY_PROXY_SUBNET and distinct reserved FEELY_PROXY_IP/FEELY_BACKEND_IP inside it."
        ) from None
    for key, value in values.items():
        if key.startswith("VITE_"):
            if key not in {"VITE_API_BASE_URL"}:
                raise RuntimeError("Only documented public VITE_* build settings are allowed.")
            if value and not value.startswith("/"):
                from backend.core.production import public_https_url

                if not public_https_url(value):
                    raise RuntimeError(f"{key} must be a public HTTPS URL or same-origin path.")
            if value and value.startswith("//"):
                raise RuntimeError(f"{key} cannot use a protocol-relative URL.")


def backend_environment(config):
    values = {}
    for name, value in config.model_dump().items():
        if value is None:
            # An explicit None for a role whose default is local must keep inheritance.
            if Settings.model_fields[name].get_default(call_default_factory=True) is not None:
                value = ""
            else:
                continue
        if isinstance(value, (list, bool)):
            value = json.dumps(value)
        else:
            value = str(value)
        if "\n" in value or "\r" in value:
            raise RuntimeError(f"{name.upper()} cannot contain a newline in the runtime env file.")
        values[name.upper()] = value
    return values


def write_backend_environment(config, target, *, replace=False):
    if target.exists() and not replace:
        raise FileExistsError("Backend env already exists; use --replace after reviewing changes.")
    lines = [f"{name}={value}" for name, value in backend_environment(config).items()]
    # Compose env_file format: raw preserves literal $, # and quotes in provider passwords.
    descriptor, temporary = tempfile.mkstemp(prefix=".feely-production-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write("\n".join(lines) + "\n")
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def compose_command(path, values, *, binary="docker", project=None):
    command = [binary]
    if Path(binary).stem.lower() not in {"docker-compose", "docker-compose.exe"}:
        command.append("compose")
    command.extend(
        [
            "--project-directory",
            str(ROOT),
            "--env-file",
            str(path.resolve()),
            "-f",
            str(ROOT / "compose.production.yml"),
        ]
    )
    if project:
        command.extend(["--project-name", project])
    # Strip developer overrides; only the selected master configuration controls deployment.
    environment = {key: value for key, value in os.environ.items() if key not in values}
    environment.update(values)
    return command, environment


def check_compose(config, values, command, environment):
    result = subprocess.run(
        [*command, "config", "--format", "json"],
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        cwd=ROOT,
    )
    if result.returncode:
        raise RuntimeError(
            "Production Compose configuration failed; check required variables and filtered env path."
        )
    model = json.loads(result.stdout)
    services = model["services"]
    if set(services) != {"backend", "postgres", "caddy"}:
        raise RuntimeError("Production must contain only backend, postgres and caddy.")
    for name in ("backend", "postgres"):
        if services[name].get("ports"):
            raise RuntimeError(f"Production {name} must not publish host ports.")
    backend = services["backend"]
    if not backend.get("read_only") or str(backend.get("user", "")) not in {"", "10001:10001"}:
        raise RuntimeError("Backend must keep its non-root image user and read-only root.")
    if backend["environment"].get("POSTGRES_PASSWORD") or backend["environment"].get(
        "POSTGRES_APP_PASSWORD"
    ):
        raise RuntimeError(
            "Database bootstrap/config secrets must not enter the backend environment."
        )
    if backend["environment"].get("ENVIRONMENT") != "production":
        raise RuntimeError("The filtered backend env must select production.")
    if backend["environment"] != backend_environment(config):
        raise RuntimeError(
            "Regenerate the filtered backend env; runtime values differ from the validated master."
        )
    if set(backend["depends_on"]) != {"postgres"}:
        raise RuntimeError("Production backend must not depend on Mailpit.")
    arguments = backend["command"]
    if (
        "--proxy-headers" not in arguments
        or arguments[arguments.index("--forwarded-allow-ips") + 1] != values["FEELY_PROXY_IP"]
    ):
        raise RuntimeError("Uvicorn must trust only the configured Caddy address.")
    if not model["networks"]["database"].get("internal"):
        raise RuntimeError("PostgreSQL must use an internal Docker network.")
    if set(services["postgres"]["networks"]) != {"database"}:
        raise RuntimeError("PostgreSQL must not join the public ingress network.")
    if any(
        "KEY" in key or "PASSWORD" in key or "SECRET" in key
        for key in services["caddy"].get("environment", {})
    ):
        raise RuntimeError("Backend secrets must not enter the Caddy environment.")
    return model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "check"))
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.production")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--compose-bin", default="docker")
    args = parser.parse_args()
    try:
        config, values = load_production(args.env_file)
        target = args.output or ROOT / values.get(
            "FEELY_PRODUCTION_APP_ENV_FILE", ".env.production.backend"
        )
        if target.resolve() == args.env_file.resolve():
            raise RuntimeError("The filtered backend env must differ from the master env file.")
        if args.action == "prepare":
            write_backend_environment(config, target, replace=args.replace)
        else:
            if args.output:
                values["FEELY_PRODUCTION_APP_ENV_FILE"] = str(target.resolve())
            command, environment = compose_command(args.env_file, values, binary=args.compose_bin)
            check_compose(config, values, command, environment)
        print(
            f"Production {args.action}: PASS. Configuration values and credentials were not printed."
        )
    except Exception as error:
        # Pydantic/driver errors can echo input secrets. Only our fixed validation messages are safe.
        message = (
            str(error)
            if type(error) in {RuntimeError, FileExistsError}
            else "Invalid or missing production configuration."
        )
        if isinstance(error, ValidationError):
            fields = sorted({str(item["loc"][0]).upper() for item in error.errors()})
            message = "Invalid production settings: " + ", ".join(fields) + "."
        print(f"Production {args.action}: FAIL. {message}")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()

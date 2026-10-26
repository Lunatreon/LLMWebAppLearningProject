"""Internal container readiness: existing HTTP health plus a bounded DB query."""

import base64
import json
import os
from urllib.request import Request, urlopen

from sqlalchemy import text

from backend.core.config import settings
from backend.db.session import create_database_engine, database_url


def check_health() -> None:
    port = int(os.environ.get("FEELY_HEALTH_PORT", "8000"))
    request = Request(f"http://127.0.0.1:{port}{settings.api_v1_prefix}/health")
    if settings.allowed_hosts:
        request.add_header("Host", settings.allowed_hosts[0])
    if settings.basic_auth_enabled:
        credentials = f"{settings.basic_auth_username or ''}:{settings.basic_auth_password or ''}"
        encoded = base64.b64encode(credentials.encode()).decode()
        request.add_header("Authorization", f"Basic {encoded}")
    with urlopen(request, timeout=3) as response:
        if response.status != 200 or json.load(response) != {"status": "ok"}:
            raise RuntimeError("Application is not ready")
    url = database_url(settings.database_url)
    connect_args = (
        {"connect_timeout": 3, "options": "-c statement_timeout=3000"}
        if url.get_backend_name() == "postgresql"
        else {}
    )
    engine = create_database_engine(url, connect_args=connect_args)
    try:
        with engine.connect() as connection:
            if connection.scalar(text("SELECT 1")) != 1:
                raise RuntimeError("Database is not ready")
    finally:
        engine.dispose()


if __name__ == "__main__":
    try:
        check_health()
    except Exception:
        # Container probes must never print DB credentials or auth headers.
        raise SystemExit(1) from None

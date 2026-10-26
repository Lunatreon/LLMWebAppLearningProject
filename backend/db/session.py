from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, URL, make_url
from sqlalchemy.orm import sessionmaker

from backend.core.config import settings


def database_url(value: str | URL) -> URL:
    """Use psycopg 3 for PostgreSQL URLs without an explicit driver."""
    url = make_url(value)
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg")
    return url


def create_database_engine(value: str | URL, **kwargs) -> Engine:
    url = database_url(value)
    connect_args = dict(kwargs.pop("connect_args", {}))
    if url.get_backend_name() == "sqlite":
        connect_args.setdefault("check_same_thread", False)
    elif url.drivername == "postgresql+psycopg":
        # SQL/JSON timestamps and expiry checks have always assumed UTC.
        options = connect_args.get("options", url.query.get("options", ""))
        connect_args["options"] = f"{options} -c timezone=UTC".strip()
    kwargs.setdefault("hide_parameters", True)
    result = create_engine(url, connect_args=connect_args, **kwargs)
    if url.get_backend_name() == "sqlite":

        @event.listens_for(result, "connect")
        def enable_foreign_keys(dbapi_connection, connection_record):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

    return result


engine = create_database_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

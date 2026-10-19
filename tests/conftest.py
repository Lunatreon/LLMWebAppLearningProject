import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from alembic import command
from alembic.config import Config
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Unit tests must never spend API credits or depend on a local model service.
os.environ["LLM_PROVIDER"] = "mock"
os.environ["CHAT_LLM_PROVIDER"] = "mock"
os.environ["TOPIC_LLM_PROVIDER"] = "mock"
os.environ["SECRET_KEY"] = "isolated-tests-only-signing-key-not-for-deployment"

from app.api.dependencies import get_db
from app.core.config import settings
from app.core.rate_limit import rate_limiter
from app.db.base import Base
from app.db.session import create_database_engine, database_url
from app.main import create_app


@pytest.fixture(autouse=True)
def reset_security_test_state(monkeypatch):
    monkeypatch.setattr(settings, "terms_version", "")
    monkeypatch.setattr(settings, "basic_auth_enabled", False)
    monkeypatch.setattr(settings, "captcha_enabled", False)
    monkeypatch.setattr(settings, "email_verification_enabled", False)
    monkeypatch.setattr(settings, "email_verification_required", False)
    monkeypatch.setattr(settings, "feedback_email_to", None)
    monkeypatch.setattr(settings, "premium_features_enabled", True)
    monkeypatch.setattr(settings, "stripe_enabled", False)
    monkeypatch.setattr(settings, "stripe_secret_key", None)
    monkeypatch.setattr(settings, "stripe_webhook_secret", None)
    monkeypatch.setattr(settings, "stripe_price_monthly", None)
    monkeypatch.setattr(settings, "stripe_price_yearly", None)
    monkeypatch.setattr(settings, "stripe_checkout_success_url", None)
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", None)
    monkeypatch.setattr(settings, "stripe_portal_return_url", None)
    rate_limiter.reset()
    yield
    rate_limiter.reset()


@pytest.fixture()
def database_engine(tmp_path):
    postgres_url = os.environ.get("FEELY_TEST_POSTGRES_URL")
    if not postgres_url:
        engine = create_database_engine(f"sqlite:///{tmp_path / 'test.db'}")
        Base.metadata.create_all(bind=engine)
        try:
            yield engine
        finally:
            engine.dispose()
        return

    url = database_url(postgres_url)
    if url.get_backend_name() != "postgresql" or not (url.database or "").endswith("_test"):
        raise ValueError("FEELY_TEST_POSTGRES_URL must name a PostgreSQL database ending in _test")
    schema = f"feely_test_{uuid4().hex}"
    admin_engine = create_database_engine(url)
    with admin_engine.begin() as connection:
        connection.execute(CreateSchema(schema))
    engine = create_database_engine(
        url, connect_args={"options": f"-c timezone=UTC -c search_path={schema}"}
    )
    try:
        with engine.begin() as connection:
            config = Config(str(ROOT_DIR / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        yield engine
    finally:
        engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        admin_engine.dispose()


@pytest.fixture()
def client(database_engine):
    app = create_app(init_database=False)
    engine = database_engine
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

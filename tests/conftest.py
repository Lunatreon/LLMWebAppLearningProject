import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Unit tests must never spend API credits or depend on a local model service.
os.environ["LLM_PROVIDER"] = "mock"
os.environ["CHAT_LLM_PROVIDER"] = "mock"
os.environ["TOPIC_LLM_PROVIDER"] = "mock"
os.environ["JOURNAL_LLM_PROVIDER"] = "mock"
os.environ["SECRET_KEY"] = "isolated-tests-only-signing-key-not-for-deployment"

from app.api.dependencies import get_db
from app.core.config import settings
from app.core.rate_limit import rate_limiter
from app.db.base import Base
from app.main import create_app


@pytest.fixture(autouse=True)
def reset_security_test_state(monkeypatch):
    monkeypatch.setattr(settings, "basic_auth_enabled", False)
    monkeypatch.setattr(settings, "captcha_enabled", False)
    monkeypatch.setattr(settings, "google_auth_enabled", False)
    monkeypatch.setattr(settings, "email_verification_enabled", False)
    monkeypatch.setattr(settings, "email_verification_required", False)
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
def client(tmp_path):
    app = create_app(init_database=False)
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    engine = create_engine(database_url, connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

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

"""Local browser-test fixture: python tests/map_ui_server.py (no real user data or AI calls)."""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
for provider in ("LLM_PROVIDER", "CHAT_LLM_PROVIDER", "TOPIC_LLM_PROVIDER", "JOURNAL_LLM_PROVIDER"):
    os.environ[provider] = "mock"
os.environ["SECRET_KEY"] = "map-browser-tests-only-not-for-deployment"

from fastapi import HTTPException
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_db
from app.api.routes import users
from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.main import create_app
from app.models.billing import BillingSubscription
from app.models.user import ChatSession, JournalEntry, User, UserProfile


def create_fixture_app():
    for setting in ("basic_auth_enabled", "captcha_enabled",
                    "email_verification_enabled", "email_verification_required", "stripe_enabled",
                    "rate_limit_enabled", "ollama_prewarm"):
        setattr(settings, setting, False)
    settings.environment = "local"
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    factory = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)
    with factory() as db:
        user = User(email="map-ui@example.com", username="map_ui", role="test", hashed_password=hash_password("map-ui-test-password"))
        db.add(user)
        db.flush()
        db.add(BillingSubscription(user_id=user.id, status="active", current_period_end=datetime.now(timezone.utc) + timedelta(days=7)))
        db.add(UserProfile(user_id=user.id, data={"self_authorship_map": {
            "updated_at": "2026-09-01T12:00:00+00:00",
            "topic_spaces": [
                {"id": "legacy-person", "title": "Support from my girlfriend during recovery",
                 "description": "You feel supported by your girlfriend as you recover. " * 30,
                 "chat_ids": ["fixture-chat"], "journal_dates": ["2026-09-01"],
                 "related_topic_ids": ["healing"],
                 "entries": [{"id": "legacy-entry", "category": "own_perception", "text": "I feel heard when we talk.", "source_chat_id": "fixture-chat"}]},
                {"id": "healing", "title": "Healing", "category": "experience", "description": "You are finding your footing again.",
                 "related_topic_ids": ["legacy-person"], "entries": []},
                {"id": "curious", "title": "Curious", "category": "trait", "description": "You enjoy exploring new ideas.", "entries": []},
            ], "unassigned_entries": [],
        }}))
        db.add(ChatSession(user_id=user.id, chat_id="fixture-chat", info={"title": "Support", "messages": [{"role": "user", "content": "I feel heard when we talk."}]}))
        db.add(JournalEntry(user_id=user.id, entry_date="2026-09-01", content="I felt supported today."))
        db.commit()

    def database():
        with factory() as db:
            yield db

    async def preview(topic):
        if topic["title"] == "Fail preview":
            raise HTTPException(502, "Fixture model unavailable. Nothing was changed.")
        return {
            "title": "Girlfriend" if topic["id"] == "legacy-person" else topic["title"],
            "category": "person" if topic["id"] == "legacy-person" else topic.get("category", "other"),
            "description": "You feel supported by her as you recover." if topic["id"] == "legacy-person" else topic.get("description") or "A topic you chose to keep.",
        }

    users.suggest_topic_refresh = preview
    app = create_app(init_database=False)
    app.dependency_overrides[get_db] = database
    app.mount("/", StaticFiles(directory=ROOT / "website", html=True))
    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_fixture_app(), host="127.0.0.1", port=8767)

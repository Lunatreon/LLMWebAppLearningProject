"""Create synthetic SQLite data for migration/restore rehearsals; never overwrite."""

import argparse
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.base import Base
from app.db.session import create_database_engine
from app.models.billing import BillingSubscription, ProcessedStripeEvent
from app.models.feedback import Feedback
from app.models.mail_message import MailMessage
from app.models.terms import TermsAcceptance
from app.models.user import ChatSession, DailyLLMUsage, JournalEntry, User, UserProfile, utc_now
from app.services.self_authorship import add_map_entry, create_topic_space, update_practice

SNAPSHOT_EMAIL = "deployment-snapshot@example.com"
SNAPSHOT_PASSWORD = "Snapshot-only-password-42"
SNAPSHOT_DATE = "2026-10-13"


def create_snapshot(path: Path) -> None:
    # Claim the filename exclusively so neither existing data nor a racing creator is overwritten.
    with path.open("xb"):
        pass
    engine = create_database_engine(f"sqlite:///{path.resolve().as_posix()}")
    try:
        Base.metadata.create_all(engine)
        now = utc_now()
        profile, topic = create_topic_space(
            {},
            title="Snapshot topic",
            description="Preserved migration data.",
            category="experience",
        )
        profile, practice = add_map_entry(
            profile,
            category="practice",
            text="Snapshot practice.",
            topic_space_id=topic["id"],
            source_chat_id="snapshot-chat",
        )
        profile, _ = update_practice(
            profile,
            entry_id=practice["id"],
            practice_status="completed",
            reflection="Snapshot reflection.",
        )
        with Session(engine) as db:
            db.add(
                User(
                    id=42,
                    email=SNAPSHOT_EMAIL,
                    username="deployment-snapshot",
                    hashed_password=hash_password(SNAPSHOT_PASSWORD),
                    role="test",
                    is_email_verified=True,
                )
            )
            db.flush()
            db.add_all(
                [
                    UserProfile(id=51, user_id=42, data=profile),
                    ChatSession(
                        id=73,
                        user_id=42,
                        chat_id="snapshot-chat",
                        info={
                            "title": "Snapshot chat",
                            "message_count": 1,
                            "messages": [
                                {
                                    "role": "user",
                                    "content": "Saved snapshot message.",
                                    "created_at": now.isoformat(),
                                },
                                {
                                    "role": "assistant",
                                    "content": "Saved snapshot reply.",
                                    "created_at": now.isoformat(),
                                },
                            ],
                            "analysis_status": "idle",
                        },
                    ),
                    DailyLLMUsage(
                        id=75, user_id=42, usage_date=now.date().isoformat(), message_count=1
                    ),
                    JournalEntry(
                        id=85,
                        user_id=42,
                        entry_date=SNAPSHOT_DATE,
                        content="Synthetic source Journal.",
                        analysis={},
                    ),
                    BillingSubscription(id=99, user_id=42, status="active"),
                    ProcessedStripeEvent(
                        id=100, stripe_event_id="evt_snapshot", event_type="invoice.paid"
                    ),
                    Feedback(
                        id=56, user_id=42, category="general", message="Synthetic source feedback."
                    ),
                    TermsAcceptance(
                        id=92,
                        user_id=42,
                        version="snapshot-v1",
                        document_url="https://example.com/terms.pdf",
                        document_sha256="a" * 64,
                        client="web",
                    ),
                    MailMessage(
                        id=101,
                        delivery_key="snapshot-mail",
                        folder="inbox",
                        sender="sender@example.com",
                        recipient=SNAPSHOT_EMAIL,
                        subject="Snapshot",
                        body="Synthetic source mail.",
                        raw=b"From: sender@example.com\r\n\r\nSynthetic source mail.",
                    ),
                ]
            )
            db.commit()
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    create_snapshot(args.output)
    print("Created a synthetic ten-table SQLite snapshot. Existing databases were not touched.")


if __name__ == "__main__":
    main()

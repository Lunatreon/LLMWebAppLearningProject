from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_admin, get_current_user, get_db
from app.core.config import settings
from app.services.feedback_notifications import send_feedback_notification
from app.core.rate_limit import enforce_rate_limit
from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import FeedbackCreate, FeedbackRead

router = APIRouter()


@router.get("/feedback/config")
def feedback_config() -> dict[str, bool]:
    return {"enabled": settings.feedback_enabled}


@router.post("/feedback", status_code=201)
def submit_feedback(
    payload: FeedbackCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, int | str]:
    if not settings.feedback_enabled:
        raise HTTPException(status_code=404, detail="Test feedback is currently closed.")
    enforce_rate_limit(f"feedback:{user.id}", max_attempts=5, window_seconds=3600)
    entry = Feedback(user_id=user.id, category=payload.category, message=payload.message)
    db.add(entry)
    db.commit()
    if settings.feedback_email_to:
        background_tasks.add_task(
            send_feedback_notification,
            entry.id,
            user.email,
            entry.category,
            entry.message,
        )
    return {"id": entry.id, "detail": "Thank you! Your feedback has been saved for the FeelY team."}


@router.get("/admin/feedback", response_model=list[FeedbackRead])
def list_feedback(
    before_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=50, ge=1, le=100),
    _: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> list[FeedbackRead]:
    query = select(Feedback, User.email).join(User, User.id == Feedback.user_id)
    if before_id is not None:
        query = query.where(Feedback.id < before_id)
    rows = db.execute(query.order_by(Feedback.id.desc()).limit(limit)).all()
    return [
        FeedbackRead(
            id=entry.id,
            category=entry.category,
            message=entry.message,
            email=email,
            created_at=entry.created_at,
        )
        for entry, email in rows
    ]

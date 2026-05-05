from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import User, UserProfile
from app.schemas.llm import LLMRequest, LLMResponse
from app.services.llm import get_llm_client

router = APIRouter()


@router.post("/message", response_model=LLMResponse)
async def send_message_to_llm(
    payload: LLMRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LLMResponse:
    profile = current_user.profile
    if profile is None:
        profile = UserProfile(user_id=current_user.id, data={})
        db.add(profile)
        db.flush()

    llm_result = await get_llm_client().respond(
        user_input=payload.message,
        profile=profile.data or {},
    )

    profile.data = llm_result.profile
    db.commit()
    db.refresh(profile)

    return LLMResponse(
        assistant_message=llm_result.assistant_message,
        profile=profile.data,
    )

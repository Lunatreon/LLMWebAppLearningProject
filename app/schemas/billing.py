from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SubscriptionStatus(str, Enum):
    NONE = "none"
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    UNPAID = "unpaid"
    CANCELED = "canceled"
    INCOMPLETE = "incomplete"
    INCOMPLETE_EXPIRED = "incomplete_expired"
    PAUSED = "paused"


class CheckoutRequest(BaseModel):
    plan: Literal["monthly", "yearly"]

    model_config = ConfigDict(extra="forbid")


class CheckoutSyncRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=255, pattern=r"^cs_[A-Za-z0-9_]+$")

    model_config = ConfigDict(extra="forbid")


class PortalSessionRequest(BaseModel):
    return_url: str | None = Field(default=None, max_length=2048)

    model_config = ConfigDict(extra="forbid")


class BillingSessionResponse(BaseModel):
    url: str


class SubscriptionResponse(BaseModel):
    status: SubscriptionStatus
    premium: bool
    my_map_access: bool
    chat_daily_limit: int
    plan: Literal["free", "monthly", "yearly", "premium"]
    cancel_at_period_end: bool
    current_period_end: datetime | None
    billing_available: bool
    available_plans: list[Literal["monthly", "yearly"]]
    management_available: bool
    can_resume: bool


class WebhookResponse(BaseModel):
    received: bool = True
    duplicate: bool = False

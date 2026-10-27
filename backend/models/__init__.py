"""Register every persisted entity in the shared metadata."""

from backend.models.billing import BillingSubscription, ProcessedStripeEvent
from backend.models.user import (
    ChatSession,
    ChatTurn,
    DailyLLMUsage,
    JournalEntry,
    User,
    UserProfile,
)
from backend.models.feedback import Feedback
from backend.models.mail_message import MailMessage
from backend.models.terms import TermsAcceptance
from backend.models.app_settings import AppSettings
from backend.models.map import (
    MapCategory,
    UserMap,
    MapTopic,
    MapEntry,
    MapTopicRelation,
    MapTopicSource,
)

__all__ = [
    "AppSettings",
    "BillingSubscription",
    "ProcessedStripeEvent",
    "ChatSession",
    "ChatTurn",
    "DailyLLMUsage",
    "JournalEntry",
    "User",
    "UserProfile",
    "Feedback",
    "MailMessage",
    "TermsAcceptance",
    "MapCategory",
    "UserMap",
    "MapTopic",
    "MapEntry",
    "MapTopicRelation",
    "MapTopicSource",
]

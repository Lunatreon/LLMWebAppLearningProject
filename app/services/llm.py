import asyncio
import json
import logging
import re
from collections import Counter
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic
from typing import Any, NoReturn, Protocol

import httpx
from fastapi import HTTPException, status

from app.core.config import settings
from app.services.self_authorship import LLM_PROTECTED_PROFILE_FIELDS, normalize_topic_category

logger = logging.getLogger(__name__)
ollama_generation_lock = asyncio.Lock()
TextChunkCallback = Callable[[str], Awaitable[None]]


RECENT_CHAT_MESSAGE_LIMIT = 2
RECENT_TOPIC_USER_MESSAGE_LIMIT = 4
CONVERSATION_NOTE_EXCERPT_WORD_LIMIT = 36
LOCAL_FOCUS_WORD_LIMIT = 14
LOCAL_TOPIC_STOPWORDS = {
    "about",
    "again",
    "also",
    "always",
    "because",
    "been",
    "being",
    "could",
    "does",
    "doing",
    "feel",
    "feeling",
    "feelings",
    "from",
    "have",
    "just",
    "kind",
    "like",
    "maybe",
    "more",
    "myself",
    "other",
    "really",
    "should",
    "something",
    "still",
    "that",
    "their",
    "there",
    "these",
    "they",
    "thing",
    "things",
    "think",
    "this",
    "through",
    "want",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
}
TOPIC_MATCH_STOPWORDS = LOCAL_TOPIC_STOPWORDS | {
    "across",
    "challenge",
    "chat",
    "core",
    "describe",
    "describes",
    "different",
    "identify",
    "identifies",
    "matter",
    "navigate",
    "navigating",
    "person",
    "people",
    "repeated",
    "specific",
    "theme",
    "user",
    "writer",
}
TOPIC_MATCH_ALIASES = {
    "clothes": "style",
    "clothing": "style",
    "fashion": "style",
    "outfit": "style",
    "outfits": "style",
    "interactions": "interaction",
    "males": "men",
    "male": "men",
    "man": "men",
    "safe": "safety",
    "unsafe": "safety",
    "vulnerable": "vulnerability",
}


async def warm_ollama_model() -> None:
    """Load configured Ollama role models without blocking application startup."""
    role_models: list[tuple[str, str, int]] = []
    if (settings.chat_llm_provider or settings.llm_provider).lower() == "ollama":
        role_models.append(
            (
                "chat",
                settings.ollama_chat_model or settings.ollama_model,
                settings.ollama_chat_num_gpu,
            )
        )
    if (settings.topic_llm_provider or settings.llm_provider).lower() == "ollama":
        role_models.append(
            (
                "topic",
                settings.ollama_topic_model or settings.ollama_model,
                settings.ollama_topic_num_gpu,
            )
        )
    journal_provider = (
        settings.journal_llm_provider
        or settings.topic_llm_provider
        or settings.llm_provider
    ).lower()
    journal_model = (
        settings.ollama_journal_model
        or settings.ollama_topic_model
        or settings.ollama_model
    )
    journal_num_gpu = (
        settings.ollama_journal_num_gpu
        if settings.ollama_journal_num_gpu is not None
        else settings.ollama_topic_num_gpu
    )
    if journal_provider == "ollama" and not any(
        model == journal_model and num_gpu == journal_num_gpu
        for _, model, num_gpu in role_models
    ):
        role_models.append(("journal", journal_model, journal_num_gpu))

    for role, model, num_gpu in role_models:
        try:
            async with ollama_generation_lock, httpx.AsyncClient(
                base_url=settings.ollama_base_url.rstrip("/"),
                timeout=settings.ollama_timeout_seconds,
            ) as client:
                response = await client.post(
                    "/api/generate",
                    json={
                        "model": model,
                        "prompt": "",
                        "stream": False,
                        "keep_alive": settings.ollama_keep_alive,
                        "options": {
                            "num_ctx": settings.ollama_context_window,
                            "num_gpu": num_gpu,
                        },
                    },
                )
                response.raise_for_status()
            logger.info("Ollama %s model %s is warm and ready", role, model)
        except Exception:
            # Readiness must not prevent auth, stored chats, or other API features.
            logger.exception("Could not prewarm Ollama %s model %s", role, model)
SCAM_ACTION_WORDS = {
    "build",
    "bypass",
    "create",
    "draft",
    "evade",
    "hide",
    "impersonate",
    "make",
    "send",
    "steal",
    "trick",
    "write",
}
SCAM_TARGET_PHRASES = (
    "credential",
    "fake login",
    "gift card",
    "login page",
    "one-time code",
    "otp",
    "password",
    "phishing",
    "recovery phrase",
    "seed phrase",
    "social security",
    "wire transfer",
)
SCAM_DEFENSIVE_WORDS = {
    "avoid",
    "awareness",
    "defend",
    "education",
    "educational",
    "identify",
    "protect",
    "received",
    "recognize",
    "report",
    "spot",
    "training",
}


def current_message_focus(user_input: str) -> str:
    words = " ".join(user_input.strip().split()).strip(" .,!?:;#").split()
    if not words:
        return "what you just shared"
    focus = " ".join(words[:LOCAL_FOCUS_WORD_LIMIT])
    if len(words) > LOCAL_FOCUS_WORD_LIMIT:
        focus += "..."
    return focus


def is_scam_abuse_request(user_input: str) -> bool:
    text = user_input.lower()
    tokens = set(re.findall(r"[a-zA-Z][a-zA-Z'-]+", text))
    if not tokens & SCAM_ACTION_WORDS:
        return False
    if tokens & SCAM_DEFENSIVE_WORDS and not any(
        phrase in text
        for phrase in (
            "fake login",
            "one-time code",
            "recovery phrase",
            "seed phrase",
            "steal",
        )
    ):
        return False
    return any(phrase in text for phrase in SCAM_TARGET_PHRASES)


def short_fragment(text: str, word_limit: int = 12) -> str:
    words = " ".join(text.strip().strip(" .,!?:;#").split()).split()
    fragment = " ".join(words[:word_limit])
    return fragment + ("..." if len(words) > word_limit else "")


def reflective_local_fallback(user_input: str) -> str:
    cleaned = " ".join(user_input.strip().split())
    lowered = cleaned.lower()
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", cleaned) if part.strip()]
    questions = [sentence.rstrip("?") for sentence in sentences if sentence.endswith("?")]

    contrast = re.split(r"\b(?:but|yet|while)\b", cleaned, maxsplit=1, flags=re.IGNORECASE)
    if len(contrast) == 2:
        first = short_fragment(contrast[0])
        second = short_fragment(contrast[1])
        return (
            f"There seem to be two real experiences pulling against each other: {first}, "
            f"and at the same time {second}. Which side feels harder to make room for right now?"
        )

    causal = re.split(r"\bbecause\b", cleaned, maxsplit=1, flags=re.IGNORECASE)
    if len(causal) == 2:
        experience = short_fragment(causal[0])
        explanation = short_fragment(causal[1])
        return (
            f"You are connecting {experience} with {explanation}. Does that explanation feel "
            "like something you know from experience, or something you are still trying to "
            "understand?"
        )

    emotion_labels = {
        "afraid": "fear",
        "anxious": "anxiety",
        "angry": "anger",
        "excited": "excitement",
        "guilty": "guilt",
        "lonely": "loneliness",
        "nervous": "nervousness",
        "relieved": "relief",
        "sad": "sadness",
        "scared": "fear",
        "worried": "worry",
    }
    emotions = [label for word, label in emotion_labels.items() if word in lowered]
    if emotions:
        emotion = emotions[0]
        question = questions[-1] if questions else None
        if question:
            return (
                f"The {emotion} seems closely connected to your question about "
                f"{short_fragment(question)}. What feels most at risk for you in that situation?"
            )
        return (
            f"There is a clear sense of {emotion} in this, but it may be carrying more than one "
            "message. Does it feel more connected to what happened, what might happen next, or "
            "how you are judging yourself?"
        )

    if questions:
        question = short_fragment(questions[-1])
        return (
            f"The question about {question} sounds important because it points to something "
            "you have not settled internally yet. What answer are you afraid might be true, "
            "and what answer do you hope could be true?"
        )

    if re.search(r"\b(?:maybe|might|could|possibly|i don't know|idk)\b", lowered):
        return (
            "You sound uncertain, but you are already testing a possibility rather than being "
            "completely without direction. What part of that possibility feels believable, "
            "and what part still does not fit?"
        )

    return (
        "There is a specific experience taking shape here, even if its meaning is not fully "
        "clear yet. What changed inside you as you put this thought into words?"
    )


def focused_chat_context(chat_info: dict[str, Any]) -> dict[str, Any]:
    messages = [
        {
            "role": message.get("role"),
            "content": message.get("content", ""),
        }
        for message in chat_info.get("messages", [])
        if isinstance(message, dict) and message.get("role") in {"user", "assistant"}
    ]
    return {
        "title": chat_info.get("title"),
        "message_count": chat_info.get("message_count", 0),
        "accepted_topic_names": list(chat_info.get("accepted_topic_names", []))[-5:],
        "conversation_summary": chat_info.get("conversation_summary"),
        "recent_messages": messages[-RECENT_CHAT_MESSAGE_LIMIT:],
    }


def focused_profile_context(profile: dict[str, Any]) -> dict[str, Any]:
    focused_profile = dict(profile or {})
    for field in LLM_PROTECTED_PROFILE_FIELDS:
        focused_profile.pop(field, None)
    return focused_profile


def confirmed_map_context(profile: dict[str, Any], chat_id: str) -> list[dict[str, Any]]:
    """Provide bounded, read-only memories from topics connected to this chat."""
    map_data = profile.get("self_authorship_map")
    if not isinstance(map_data, dict):
        return []
    spaces = [
        space for space in map_data.get("topic_spaces", [])
        if isinstance(space, dict) and chat_id in space.get("chat_ids", [])
    ]
    # ISO timestamps allow recent observations to be selected without inferring
    # when the experience itself happened. Dates below refer to saved entries.
    spaces.sort(key=lambda space: str(space.get("updated_at") or ""), reverse=True)
    context = []
    for space in spaces[:2]:
        entries = [entry for entry in space.get("entries", []) if isinstance(entry, dict)]
        entries.sort(key=lambda entry: str(entry.get("updated_at") or entry.get("created_at") or ""),
                     reverse=True)
        context.append({
            "topic": str(space.get("title") or "")[:100],
            "observations": [
                {
                    "category": entry.get("category"),
                    "text": str(entry.get("text") or "")[:240],
                    "saved_at": entry.get("created_at"),
                    "updated_at": entry.get("updated_at"),
                    **({"status": entry.get("status"),
                        "reflection": str(entry.get("reflection") or "")[:240]}
                       if entry.get("category") == "practice" else {}),
                }
                for entry in entries[:3]
            ],
        })
    return context


def topic_chat_context(chat_info: dict[str, Any]) -> dict[str, Any]:
    user_messages = [
        str(message.get("content", ""))
        for message in chat_info.get("messages", [])
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    return {
        "current_title": chat_info.get("title"),
        "accepted_topic_names": list(chat_info.get("accepted_topic_names", [])),
        "conversation_summary": chat_info.get("conversation_summary"),
        "user_messages": user_messages[-RECENT_TOPIC_USER_MESSAGE_LIMIT:],
    }


def update_conversation_summary(chat_info: dict[str, Any]) -> dict[str, Any]:
    """Store compact, extractive notes without asking a model to reinterpret the user."""

    updated = dict(chat_info or {})
    user_messages = [
        " ".join(str(message.get("content") or "").split())
        for message in updated.get("messages", [])
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    older_messages = user_messages[:-2]
    if not older_messages:
        updated.pop("conversation_summary", None)
        updated["summary_message_count"] = 0
        return updated

    candidates = [older_messages[0], *older_messages[-2:]]
    excerpts: list[str] = []
    for candidate in candidates:
        excerpt = " ".join(candidate.split()[:CONVERSATION_NOTE_EXCERPT_WORD_LIMIT])
        if excerpt and excerpt not in excerpts:
            excerpts.append(excerpt)
    updated["conversation_summary"] = "Earlier user statements (verbatim excerpts): " + " | ".join(
        f'“{excerpt}”' for excerpt in excerpts
    )
    updated["summary_message_count"] = max(0, int(updated.get("message_count", 0)) - 2)
    return updated


def infer_local_freeform_topic(user_messages: list[str]) -> str:
    tokens = re.findall(r"[a-zA-Z][a-zA-Z'-]{3,}", " ".join(user_messages).lower())
    counts = Counter(token for token in tokens if token not in LOCAL_TOPIC_STOPWORDS)
    keywords = [word for word, _ in counts.most_common(3)]
    if not keywords:
        return "Emerging Personal Theme"
    if len(keywords) == 1:
        return f"Exploring {keywords[0].title()}"
    return f"{keywords[0].title()} and {keywords[1].title()}"


def topic_match_tokens(value: Any) -> set[str]:
    """Return conservative concept tokens for high-confidence topic reuse."""

    tokens: set[str] = set()
    for raw_token in re.findall(r"[a-zA-Z][a-zA-Z'-]{2,}", str(value or "").lower()):
        token = raw_token.strip("'-")
        token = TOPIC_MATCH_ALIASES.get(token, token)
        if token.endswith("ies") and len(token) > 5:
            token = f"{token[:-3]}y"
        elif token.endswith("s") and len(token) > 4 and not token.endswith("ss"):
            token = token[:-1]
        token = TOPIC_MATCH_ALIASES.get(token, token)
        if token and token not in TOPIC_MATCH_STOPWORDS:
            tokens.add(token)
    return tokens


def best_existing_topic_match(
    topic: str,
    description: str,
    available_topics: list[dict[str, Any]] | None,
    category: str = "other",
) -> str | None:
    """Find a clear existing home for a differently named but similar topic.

    This deliberately requires several shared concepts. The Topic-LLM remains
    responsible for ambiguous matches, while this catches obvious near-duplicate
    bubbles that smaller local models sometimes miss.
    """

    proposed_title_tokens = topic_match_tokens(topic)
    proposed_all_tokens = proposed_title_tokens | topic_match_tokens(description)
    best_match_id: str | None = None
    best_score = 0.0

    for candidate in available_topics or []:
        candidate_category = normalize_topic_category(candidate.get("category"))
        if category != "other" and candidate_category not in (category, "other"):
            continue
        candidate_id = candidate.get("id")
        if not isinstance(candidate_id, str) or not candidate_id:
            continue
        candidate_title_tokens = topic_match_tokens(candidate.get("title"))
        candidate_all_tokens = candidate_title_tokens | topic_match_tokens(
            candidate.get("description")
        )
        if not proposed_title_tokens or not candidate_title_tokens:
            continue

        shared_title = proposed_title_tokens & candidate_title_tokens
        shared_all = proposed_all_tokens & candidate_all_tokens
        title_coverage = len(shared_title) / max(
            1,
            min(len(proposed_title_tokens), len(candidate_title_tokens)),
        )
        is_clear_match = (
            len(shared_title) >= 2
            and (len(shared_all) >= 3 or title_coverage >= 0.6)
        ) or (
            len(shared_title) >= 1
            and len(shared_all) >= 4
            and title_coverage >= 0.25
        )
        if not is_clear_match:
            continue

        score = (len(shared_title) * 4) + len(shared_all) + title_coverage
        if score > best_score:
            best_match_id = candidate_id
            best_score = score

    return best_match_id


@dataclass
class ChatLLMResult:
    assistant_message: str
    profile: dict[str, Any]
    map_suggestion: dict[str, str] | None = None


@dataclass
class TopicLLMResult:
    topic: str
    description: str
    existing_topic_id: str | None = None
    parent_topic_id: str | None = None
    additional_topics: list["TopicLLMResult"] = field(default_factory=list)
    category: str = "other"
    related_topic_ids: list[str] = field(default_factory=list)


@dataclass
class JournalLLMResult:
    suggestions: list[dict[str, str]]


class ChatLLMClient(Protocol):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        """Return the direct chat response and complete updated user profile."""


class TopicLLMClient(Protocol):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        """Return a topic and short description for an analysed chat."""



class LocalChatLLMClient:
    """Development fallback for the Chat-LLM path."""

    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        updated_profile = dict(profile or {})
        updated_profile["last_user_message"] = user_input
        updated_profile["last_chat_id"] = chat_id
        updated_profile["message_count"] = int(updated_profile.get("message_count", 0)) + 1

        recent_messages = list(updated_profile.get("recent_messages", []))
        recent_messages.append(user_input)
        updated_profile["recent_messages"] = recent_messages[-10:]

        assistant_message = self.local_response(user_input, chat_info)
        if on_text_chunk is not None:
            await on_text_chunk(assistant_message)
        return ChatLLMResult(
            assistant_message=assistant_message,
            profile=updated_profile,
            map_suggestion=self.local_map_suggestion(user_input),
        )

    def local_map_suggestion(self, user_input: str) -> dict[str, str] | None:
        """Offer one concrete, user-confirmed map entry when the signal is clear."""

        text = user_input.lower()
        if "walk" in text and any(word in text for word in ("reset", "calm", "clear")):
            return {
                "category": "body_signal",
                "text": "Walking helps my nervous system reset and makes my thoughts clearer.",
                "reason": "You connected walking with a noticeable change in your mental state.",
            }
        if any(word in text for word in ("parents", "father", "mother", "family")) and any(
            word in text for word in ("safety", "obedience", "judge", "judging", "told")
        ):
            return {
                "category": "inherited_script",
                "text": "I should choose safety and obedience over what feels meaningful to me.",
                "reason": "This sounds like a repeated family instruction rather than a choice you authored.",
            }
        if "activism" in text and any(
            phrase in text for phrase in ("myself", "take responsibility", "take the lead")
        ):
            return {
                "category": "own_perception",
                "text": "I feel more like myself when I take responsibility in activism.",
                "reason": "You described activism as a place where your own agency becomes easier to feel.",
            }
        if any(phrase in text for phrase in ("i value", "important to me", "matters to me")):
            return {
                "category": "value",
                "text": short_fragment(user_input, word_limit=20),
                "reason": "You named something as personally important rather than merely expected.",
            }
        if any(phrase in text for phrase in ("i will try", "i want to practice", "my next step")):
            return {
                "category": "practice",
                "text": short_fragment(user_input, word_limit=24),
                "reason": "You described a concrete response that could be tried and reviewed.",
            }
        return None

    def local_response(self, user_input: str, chat_info: dict[str, Any]) -> str:
        text = user_input.lower()
        previous_turns = int(chat_info.get("message_count", 0))
        focus = current_message_focus(user_input)

        if any(
            phrase in text
            for phrase in (
                "kill myself",
                "end my life",
                "hurt myself",
                "suicide",
                "harm someone",
            )
        ):
            return (
                f'When you say "{focus}", your immediate safety matters most. Please contact '
                "local emergency services or a crisis line now, and if possible stay with "
                "someone you trust rather than handling this alone. Are you in immediate "
                "danger right now?"
            )

        if is_scam_abuse_request(user_input):
            return (
                "I cannot help create phishing, impersonation, credential theft, or scam "
                "material. If your goal is to protect yourself or someone else, paste the "
                "message you are worried about and I can help you identify warning signs and "
                "choose a safe next step."
            )

        if any(word in text for word in ("parents", "father", "mother", "family")) and any(
            word in text
            for word in (
                "judge",
                "judging",
                "worth",
                "responsibility",
                "independent",
                "activism",
                "studies",
                "safety",
            )
        ):
            return (
                "You describe your parents' voices as pushing you toward safety, obedience, "
                "and doubt, while the part of you that found activism wants responsibility, "
                "choice, and a life that feels like your own. That sounds less like a lack of "
                "ability and more like a conflict over whose judgment gets to define you. "
                "When you feel that independent part of yourself most clearly, what are you "
                "doing differently from what your parents expected?"
            )

        if "walk" in text and any(word in text for word in ("thesis", "studies", "programming")):
            return (
                "A walk and working on your thesis seem to meet two different needs: the walk "
                "helps your nervous system reset, while the thesis lets you challenge the old "
                "message that you cannot finish your studies. Which one would support you now "
                "without turning the choice into another test of your worth?"
            )

        if "walk" in text and any(word in text for word in ("reset", "self esteem", "self-esteem")):
            return (
                "Walking sounds like a way to lower the volume of everything around you long "
                "enough to hear your own perception again. That reset does not have to be an "
                "escape; it can create space between an inherited expectation and the response "
                "you actually want to choose. What becomes easier to recognize as your own "
                "after you have walked for a while?"
            )

        if any(phrase in text for phrase in ("writing about it", "writting about it", "write about it")):
            return (
                "Writing seems to be giving you enough distance to notice what is happening "
                "without immediately handing the distress to someone else. You do not need to "
                "solve everything while you write; naming the feeling and the urge that follows "
                "it can already help you choose what to do next. What becomes clearer when you "
                "write it here than when you hold it in your head?"
            )

        if any(phrase in text for phrase in ("other people handle", "handle my distress", "handle my disstress")):
            return (
                "Noticing the urge to have other people regulate your distress is already more "
                "specific than calling yourself a burden. Before reaching out, you could pause "
                "and ask whether you want connection, reassurance, or someone to solve the "
                "feeling for you. Which of those needs is strongest for you in this moment?"
            )

        if "directly influence" in text or (
            any(word in text for word in ("meet her", "see her"))
            and any(word in text for word in ("feeling down", "trigger", "draining"))
        ):
            return (
                "You are identifying a real choice: whether meeting her right now would be "
                "shared time or an attempt to make her regulate how low you feel. That does not "
                "mean you must isolate whenever you are sad. It means checking what support you "
                "need, what you can handle yourself first, and being honest about both before "
                "you decide. What would tell you that meeting her would be connection rather "
                "than asking her to carry the feeling?"
            )

        if any(word in text for word in ("girlfriend", "partner", "boyfriend")) and any(
            phrase in text
            for phrase in (
                "doesn't like me",
                "doesnt like me",
                "don't like me",
                "dont like me",
                "does not like me",
            )
        ):
            return (
                "That conclusion sounds painful, but do not treat it as fact too quickly. "
                "What makes you think she does not like you: something she said, something "
                "she did, or the fear filling in the gap? Check what evidence points toward "
                "it, what evidence points another way, and then choose one calm next step "
                "instead of letting the prediction run the whole situation."
            )

        if any(word in text for word in ("space", "time", "focus myself")) and any(
            word in text for word in ("change", "behavior", "behaviour", "work on")
        ):
            return (
                "Giving her space while you work on your own behavior sounds more concrete "
                "than trying to repair everything through another promise. You could choose "
                "one behavior to practice consistently while respecting the space she needs. "
                "Which behavior would be most important to start with?"
            )

        if any(word in text for word in ("falling apart", "lose her", "scared", "afraid")):
            return (
                "The fear of losing the relationship can make it tempting to seek reassurance "
                "right away, but responsibility is something you can show even while the "
                "outcome is uncertain. A small next step could be respecting her space and "
                "following through on one change without asking her to supervise it. What does "
                "the fear say will happen if you do not get reassurance immediately?"
            )

        if any(word in text for word in ("responsibility", "responsible", "my action")):
            return (
                "Taking responsibility becomes meaningful when it is visible in what you do "
                "next, not only in what you promise. Pick one action you can complete on your "
                "own, keep it small enough to repeat, and let consistency carry the message. "
                "What action could you realistically complete today?"
            )

        if any(word in text for word in ("relationship", "partner", "person i love", "love")):
            return (
                "You seem to be holding both remorse about the relationship and frustration "
                "with how depression and avoidance affect your actions. You cannot control "
                "whether the relationship feels secure immediately, but you can reduce the "
                "burden on her by choosing one change that does not require her to guide or "
                "stabilize you. Which part feels more urgent right now: repairing trust, "
                "understanding your behavior, or tolerating the uncertainty?"
            )

        if any(word in text for word in ("depressed", "depression", "stuck", "freeze")):
            return (
                "Feeling stuck can make every change seem like one enormous task. Instead of "
                "trying to fix yourself all at once, choose an action that takes only a few "
                "minutes and can be repeated without someone else prompting you. What is one "
                "step that feels possible even on a difficult day?"
            )

        if any(word in text for word in ("project", "task", "workflow", "deadline", "goal")):
            if previous_turns >= 2:
                return (
                    "Your plan is becoming more specific: you have a goal, a workflow concern, "
                    "and a deadline to work with. Choose the next task by impact rather than "
                    "trying to improve the whole system at once, then review what blocked or "
                    "helped you after you finish it."
                )
            if previous_turns == 1:
                return (
                    "Planning the project in manageable tasks is a useful shift from a broad "
                    "intention to something observable. Choose one task with a clear stopping "
                    "point and complete that before revising the rest of the plan."
                )
            return (
                "You already have a clearer direction here. Turn it into one specific task, "
                "give it a small finish line, and notice what helps you follow through. What "
                "would count as meaningful progress today?"
            )

        return reflective_local_fallback(user_input)


class LocalTopicLLMClient:
    """Development fallback for topic creation after pattern analysis."""

    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        user_messages = topic_chat_context(chat_info)["user_messages"]
        topic = topic_hint or infer_local_freeform_topic(user_messages)
        description = (
            "This chat appears to focus on "
            f"{topic}, based on the user's recent messages: "
            f"{' '.join(user_messages[-2:])[:240]}"
        )
        return TopicLLMResult(topic=topic[:120], description=description[:1000])

PROMPT_FILENAMES = {
    "chat": "chat_system.txt",
    "topic": "topic_system.txt",
    "map_refresh": "map_refresh_system.txt",
    "journal": "journal_system.txt",
}


class PromptConfigurationError(RuntimeError):
    """Raised when a required editable system-prompt file is unavailable."""


def prompt_file_path(kind: str) -> Path:
    filename = PROMPT_FILENAMES.get(kind)
    if filename is None:
        raise ValueError("Unknown prompt kind")
    configured = Path(settings.prompt_directory)
    directory = configured if configured.is_absolute() else Path(__file__).resolve().parents[2] / configured
    return directory / filename


def read_system_prompt(kind: str) -> str:
    path = prompt_file_path(kind)
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise PromptConfigurationError(
            f"The {kind} system prompt could not be read from {path}."
        ) from exc
    if not text:
        raise PromptConfigurationError(f"The {kind} system prompt file is empty: {path}.")
    return text


def write_system_prompt(kind: str, text: str) -> str:
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Prompt text cannot be empty")
    path = prompt_file_path(kind)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(cleaned + "\n", encoding="utf-8")
    temporary_path.replace(path)
    return cleaned


CHAT_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "assistant_message": {"type": "string"},
        "profile": {"type": "object"},
        "map_suggestion": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "properties": {
                        "category": {
                            "type": "string",
                            "enum": [
                                "inherited_script",
                                "own_perception",
                                "value",
                                "body_signal",
                                "practice",
                                "evidence",
                            ],
                        },
                        "text": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["category", "text", "reason"],
                    "additionalProperties": False,
                },
            ]
        },
    },
    "required": ["assistant_message", "map_suggestion"],
    "additionalProperties": False,
}


TOPIC_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "topic": {"type": "string"},
        "description": {"type": "string"},
        "category": {"type": "string", "enum": ["person", "trait", "experience", "other"]},
        "related_topic_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 24},
        "existing_topic_id": {
            "anyOf": [{"type": "string"}, {"type": "null"}],
        },
        "parent_topic_id": {
            "anyOf": [{"type": "string"}, {"type": "null"}],
        },
        "additional_topics": {
            "type": "array",
            "maxItems": 2,
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "description": {"type": "string"},
                    "category": {"type": "string", "enum": ["person", "trait", "experience", "other"]},
                    "related_topic_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 24},
                    "existing_topic_id": {
                        "anyOf": [{"type": "string"}, {"type": "null"}],
                    },
                    "parent_topic_id": {
                        "anyOf": [{"type": "string"}, {"type": "null"}],
                    },
                },
                "required": [
                    "topic",
                    "description",
                    "category",
                    "related_topic_ids",
                    "existing_topic_id",
                    "parent_topic_id",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "topic",
        "description",
        "category",
        "related_topic_ids",
        "existing_topic_id",
        "parent_topic_id",
        "additional_topics",
    ],
    "additionalProperties": False,
}


JOURNAL_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["topic", "map_entry"]},
                    "category": {
                        "type": "string",
                        "enum": [
                            "topic",
                            "inherited_script",
                            "own_perception",
                            "value",
                            "body_signal",
                            "practice",
                            "evidence",
                        ],
                    },
                    "topic_category": {"type": "string", "enum": ["person", "trait", "experience", "other"]},
                    "title": {"type": "string"},
                    "text": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["kind", "category", "topic_category", "title", "text", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}


def chat_request_payload(
    user_input: str,
    profile: dict[str, Any],
    chat_info: dict[str, Any],
    chat_id: str,
) -> str:
    return json.dumps(
        {
            "chat_id": chat_id,
            "current_profile": focused_profile_context(profile or {}),
            "recent_chat_context": focused_chat_context(chat_info or {}),
            "confirmed_map_context": confirmed_map_context(profile or {}, chat_id),
            "new_user_input": user_input,
        },
        ensure_ascii=True,
    )


def topic_request_payload(
    chat_info: dict[str, Any],
    matched_patterns: list[str],
    topic_hint: str | None,
    available_topics: list[dict[str, Any]] | None = None,
) -> str:
    return json.dumps(
        {
            "topic_chat_context": topic_chat_context(chat_info or {}),
            "matched_patterns": matched_patterns,
            "topic_hint": topic_hint,
            "available_topics": available_topics or [],
        },
        ensure_ascii=True,
    )


def journal_request_payload(journal_text: str, entry_date: str) -> str:
    return json.dumps(
        {
            "entry_date": entry_date,
            "journal_text": journal_text,
            "instruction": "Return only grounded suggestions. The user decides what to save.",
        },
        ensure_ascii=True,
    )


def chat_result_from_payload(payload: dict[str, Any]) -> ChatLLMResult:
    assistant_message = payload.get("assistant_message")
    updated_profile = payload.get("profile")
    map_suggestion = payload.get("map_suggestion")
    if not isinstance(assistant_message, str) or not assistant_message.strip():
        raise_bad_gateway("Chat-LLM response did not match the expected schema")
    if not isinstance(updated_profile, dict):
        updated_profile = {}
    if map_suggestion is not None:
        valid_categories = {
            "inherited_script",
            "own_perception",
            "value",
            "body_signal",
            "practice",
            "evidence",
        }
        if (
            not isinstance(map_suggestion, dict)
            or map_suggestion.get("category") not in valid_categories
            or not isinstance(map_suggestion.get("text"), str)
            or not isinstance(map_suggestion.get("reason"), str)
        ):
            logger.warning("Discarding a malformed optional Chat-LLM map suggestion")
            map_suggestion = None
    return ChatLLMResult(
        assistant_message=assistant_message,
        profile=updated_profile,
        map_suggestion=map_suggestion,
    )


def topic_related_ids(payload: dict[str, Any]) -> list[str]:
    ids = payload.get("related_topic_ids")
    if not isinstance(ids, list):
        return []
    return list(dict.fromkeys(value for value in ids if isinstance(value, str) and value))[:24]


def topic_result_from_payload(payload: dict[str, Any]) -> TopicLLMResult:
    topic = payload.get("topic")
    description = payload.get("description")
    if not isinstance(topic, str) or not isinstance(description, str):
        raise_bad_gateway("Topic-LLM response did not match the expected schema")
    existing_topic_id = payload.get("existing_topic_id")
    parent_topic_id = payload.get("parent_topic_id")
    additional_topics: list[TopicLLMResult] = []
    raw_additional_topics = payload.get("additional_topics", [])
    if isinstance(raw_additional_topics, list):
        for raw_topic in raw_additional_topics[:2]:
            if not isinstance(raw_topic, dict):
                continue
            additional_topic = raw_topic.get("topic")
            additional_description = raw_topic.get("description")
            if (
                not isinstance(additional_topic, str)
                or not additional_topic.strip()
                or not isinstance(additional_description, str)
                or not additional_description.strip()
            ):
                continue
            additional_existing_topic_id = raw_topic.get("existing_topic_id")
            additional_parent_topic_id = raw_topic.get("parent_topic_id")
            additional_topics.append(
                TopicLLMResult(
                    topic=additional_topic[:120],
                    description=additional_description[:2000],
                    category=normalize_topic_category(raw_topic.get("category")),
                    related_topic_ids=topic_related_ids(raw_topic),
                    existing_topic_id=(
                        additional_existing_topic_id
                        if isinstance(additional_existing_topic_id, str)
                        else None
                    ),
                    parent_topic_id=(
                        additional_parent_topic_id
                        if isinstance(additional_parent_topic_id, str)
                        else None
                    ),
                )
            )
    return TopicLLMResult(
        topic=topic[:120],
        description=description[:2000],
        category=normalize_topic_category(payload.get("category")),
        related_topic_ids=topic_related_ids(payload),
        existing_topic_id=existing_topic_id if isinstance(existing_topic_id, str) else None,
        parent_topic_id=parent_topic_id if isinstance(parent_topic_id, str) else None,
        additional_topics=additional_topics,
    )


def journal_result_from_payload(payload: dict[str, Any]) -> JournalLLMResult:
    raw_suggestions = payload.get("suggestions")
    if not isinstance(raw_suggestions, list):
        raise_bad_gateway("Journal-LLM response did not match the expected schema")

    valid_map_categories = {
        "inherited_script",
        "own_perception",
        "value",
        "body_signal",
        "practice",
        "evidence",
    }
    suggestions: list[dict[str, str]] = []
    for raw in raw_suggestions[:6]:
        if not isinstance(raw, dict):
            continue
        kind = raw.get("kind")
        category = raw.get("category")
        title = raw.get("title")
        text = raw.get("text")
        reason = raw.get("reason")
        if not all(isinstance(value, str) for value in (category, title, text, reason)):
            continue
        if kind == "topic" and category == "topic" and title.strip() and text.strip():
            suggestions.append(
                {
                    "kind": "topic",
                    "category": "topic",
                    "topic_category": normalize_topic_category(raw.get("topic_category")),
                    "title": title.strip()[:120],
                    "text": text.strip()[:1000],
                    "reason": reason.strip()[:1000],
                }
            )
        elif kind == "map_entry" and category in valid_map_categories and text.strip():
            suggestions.append(
                {
                    "kind": "map_entry",
                    "category": category,
                    "title": title.strip()[:120],
                    "text": text.strip()[:1000],
                    "reason": reason.strip()[:1000],
                }
            )
    return JournalLLMResult(suggestions=suggestions)


class OpenAIBaseClient:
    def __init__(self, api_key: str, model: str) -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model


class OpenAIChatLLMClient(OpenAIBaseClient):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        response = await self.client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": read_system_prompt("chat"),
                },
                {
                    "role": "user",
                    "content": chat_request_payload(user_input, profile, chat_info, chat_id),
                },
            ],
        )
        result = chat_result_from_payload(
            parse_json_response(response.choices[0].message.content)
        )
        if on_text_chunk is not None:
            await on_text_chunk(result.assistant_message)
        return result


class OpenAITopicLLMClient(OpenAIBaseClient):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        response = await self.client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": read_system_prompt("topic"),
                },
                {
                    "role": "user",
                    "content": topic_request_payload(
                        chat_info,
                        matched_patterns,
                        topic_hint,
                        available_topics,
                    ),
                },
            ],
        )
        return topic_result_from_payload(
            parse_json_response(response.choices[0].message.content)
        )

class AnthropicBaseClient:
    def __init__(self, api_key: str, model: str, max_tokens: int) -> None:
        from anthropic import AsyncAnthropic

        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens

    @staticmethod
    def response_text(response: Any) -> str:
        return "".join(
            block.text
            for block in response.content
            if getattr(block, "type", None) == "text" and isinstance(block.text, str)
        )


class AnthropicChatLLMClient(AnthropicBaseClient):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=read_system_prompt("chat"),
            messages=[
                {
                    "role": "user",
                    "content": chat_request_payload(user_input, profile, chat_info, chat_id),
                }
            ],
        )
        result = chat_result_from_payload(
            parse_json_response(self.response_text(response))
        )
        if on_text_chunk is not None:
            await on_text_chunk(result.assistant_message)
        return result


class AnthropicTopicLLMClient(AnthropicBaseClient):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=read_system_prompt("topic"),
            messages=[
                {
                    "role": "user",
                    "content": topic_request_payload(
                        chat_info,
                        matched_patterns,
                        topic_hint,
                        available_topics,
                    ),
                }
            ],
        )
        return topic_result_from_payload(
            parse_json_response(self.response_text(response))
        )

class OllamaBaseClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout_seconds: float,
        context_window: int,
        max_tokens: int,
        num_gpu: int,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.client: Any | None = None
        self.model = model
        self.context_window = context_window
        self.max_tokens = max_tokens
        self.num_gpu = num_gpu

    async def post(self, path: str, payload: dict[str, Any]) -> httpx.Response:
        if self.client is not None:
            return await self.client.post(path, json=payload)
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout_seconds,
        ) as client:
            return await client.post(path, json=payload)

    @asynccontextmanager
    async def stream(
        self,
        path: str,
        payload: dict[str, Any],
    ) -> AsyncIterator[httpx.Response]:
        if self.client is not None:
            async with self.client.stream(path, json=payload) as response:
                yield response
            return
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout_seconds,
        ) as client, client.stream("POST", path, json=payload) as response:
            yield response

    def chat_request_body(
        self,
        system_prompt: str,
        user_payload: str,
        response_schema: dict[str, Any],
        temperature: float,
        *,
        stream: bool,
    ) -> dict[str, Any]:
        return {
            "model": self.model,
            "stream": stream,
            "think": False,
            "keep_alive": settings.ollama_keep_alive,
            "format": response_schema,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_payload},
            ],
            "options": {
                "num_ctx": self.context_window,
                "num_predict": self.max_tokens,
                "num_gpu": self.num_gpu,
                "temperature": temperature,
            },
        }

    async def request_json(
        self,
        system_prompt: str,
        user_payload: str,
        response_schema: dict[str, Any],
        temperature: float,
    ) -> dict[str, Any]:
        started_at = monotonic()
        try:
            # Avoid competing local generations fighting over the same RAM/VRAM.
            async with ollama_generation_lock:
                response = await self.post(
                    "/api/chat",
                    self.chat_request_body(
                        system_prompt,
                        user_payload,
                        response_schema,
                        temperature,
                        stream=False,
                    ),
                )
            response.raise_for_status()
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Could not connect to Ollama. Start Ollama and make sure "
                    f"it is available at {self.base_url}."
                ),
            ) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Ollama took too long to generate a response",
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = ollama_error_detail(exc.response)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ollama request failed: {detail}",
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ollama request failed: {exc}",
            ) from exc

        logger.info(
            "Ollama model %s completed in %.2fs",
            self.model,
            monotonic() - started_at,
        )

        try:
            response_payload = response.json()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Ollama returned an invalid HTTP response",
            ) from exc

        if not isinstance(response_payload, dict):
            raise_bad_gateway("Ollama returned an unexpected HTTP response")
        message = response_payload.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        return parse_json_response(content)

    async def request_json_stream(
        self,
        system_prompt: str,
        user_payload: str,
        response_schema: dict[str, Any],
        temperature: float,
        on_text_chunk: TextChunkCallback,
    ) -> tuple[dict[str, Any], str]:
        """Stream Ollama NDJSON while exposing only the assistant text field."""

        started_at = monotonic()
        generated_json = ""
        emitted_text = ""
        stream_finished = False
        try:
            # Ollama can stream its structured JSON a fragment at a time. Keep
            # the full JSON private and emit only the decoded assistant message.
            async with ollama_generation_lock, self.stream(
                "/api/chat",
                self.chat_request_body(
                    system_prompt,
                    user_payload,
                    response_schema,
                    temperature,
                    stream=True,
                ),
            ) as response:
                if response.is_error:
                    await response.aread()
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        raise_bad_gateway("Ollama returned an invalid stream event")
                    if not isinstance(event, dict):
                        raise_bad_gateway("Ollama returned an unexpected stream event")
                    if isinstance(event.get("error"), str):
                        raise_bad_gateway(f"Ollama request failed: {event['error']}")

                    message = event.get("message")
                    content = message.get("content") if isinstance(message, dict) else None
                    if isinstance(content, str):
                        generated_json += content
                        visible_text = assistant_message_prefix_from_json(generated_json)
                        if len(visible_text) > len(emitted_text):
                            delta = visible_text[len(emitted_text) :]
                            emitted_text = visible_text
                            await on_text_chunk(delta)
                    if event.get("done") is True:
                        stream_finished = True
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Could not connect to Ollama. Start Ollama and make sure "
                    f"it is available at {self.base_url}."
                ),
            ) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Ollama took too long to generate a response",
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = ollama_error_detail(exc.response)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ollama request failed: {detail}",
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ollama request failed: {exc}",
            ) from exc

        if not stream_finished:
            raise_bad_gateway("Ollama ended the response stream unexpectedly")
        logger.info(
            "Ollama model %s completed in %.2fs",
            self.model,
            monotonic() - started_at,
        )
        try:
            payload = parse_json_response(generated_json)
        except HTTPException as exc:
            if exc.status_code != status.HTTP_502_BAD_GATEWAY or not emitted_text.strip():
                raise
            # The assistant_message string is decoded incrementally before any
            # private structured fields are exposed. If Qwen finishes that
            # message but damages the surrounding JSON, keep the useful reply
            # and discard only the optional profile/map data.
            logger.warning(
                "Recovering %s streamed assistant characters after malformed Ollama JSON",
                len(emitted_text),
            )
            payload = {
                "assistant_message": emitted_text,
                "profile": {},
                "map_suggestion": None,
            }
        return payload, emitted_text


class OllamaChatLLMClient(OllamaBaseClient):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        request_payload = chat_request_payload(user_input, profile, chat_info, chat_id)
        emitted_text = ""
        if on_text_chunk is None:
            payload = await self.request_json(
                system_prompt=read_system_prompt("chat"),
                user_payload=request_payload,
                response_schema=CHAT_RESPONSE_SCHEMA,
                temperature=0.5,
            )
        else:
            payload, emitted_text = await self.request_json_stream(
                system_prompt=read_system_prompt("chat"),
                user_payload=request_payload,
                response_schema=CHAT_RESPONSE_SCHEMA,
                temperature=0.5,
                on_text_chunk=on_text_chunk,
            )
        result = chat_result_from_payload(payload)
        if on_text_chunk is not None and result.assistant_message.startswith(emitted_text):
            remaining_text = result.assistant_message[len(emitted_text) :]
            if remaining_text:
                await on_text_chunk(remaining_text)
        return result


class OllamaTopicLLMClient(OllamaBaseClient):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        payload = await self.request_json(
            system_prompt=read_system_prompt("topic"),
            user_payload=topic_request_payload(
                chat_info,
                matched_patterns,
                topic_hint,
                available_topics,
            ),
            response_schema=TOPIC_RESPONSE_SCHEMA,
            temperature=0.2,
        )
        return topic_result_from_payload(payload)

def ollama_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text or f"HTTP {response.status_code}"
    if isinstance(payload, dict) and isinstance(payload.get("error"), str):
        return payload["error"]
    return f"HTTP {response.status_code}"


JSON_ESCAPE_CHARACTERS = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}


def top_level_json_string_value_start(content: str, field_name: str) -> int | None:
    """Find a top-level string field without matching text inside nested values."""

    depth = 0
    index = 0
    while index < len(content):
        character = content[index]
        if character == "{":
            depth += 1
            index += 1
            continue
        if character == "}":
            depth = max(0, depth - 1)
            index += 1
            continue
        if character != '"':
            index += 1
            continue

        string_start = index
        index += 1
        escaped = False
        while index < len(content):
            character = content[index]
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                break
            index += 1
        if index >= len(content):
            return None

        string_end = index + 1
        if depth == 1:
            after_string = string_end
            while after_string < len(content) and content[after_string].isspace():
                after_string += 1
            if after_string < len(content) and content[after_string] == ":":
                try:
                    key = json.loads(content[string_start:string_end])
                except json.JSONDecodeError:
                    return None
                if key == field_name:
                    value_start = after_string + 1
                    while value_start < len(content) and content[value_start].isspace():
                        value_start += 1
                    if value_start < len(content) and content[value_start] == '"':
                        return value_start + 1
                    return None
        index = string_end
    return None


def assistant_message_prefix_from_json(content: str) -> str:
    """Decode the complete prefix of assistant_message from partial JSON."""

    value_start = top_level_json_string_value_start(content, "assistant_message")
    if value_start is None:
        return ""

    decoded: list[str] = []
    index = value_start
    while index < len(content):
        character = content[index]
        if character == '"':
            break
        if character != "\\":
            decoded.append(character)
            index += 1
            continue

        if index + 1 >= len(content):
            break
        escape = content[index + 1]
        if escape in JSON_ESCAPE_CHARACTERS:
            decoded.append(JSON_ESCAPE_CHARACTERS[escape])
            index += 2
            continue
        if escape != "u" or index + 6 > len(content):
            break

        hexadecimal = content[index + 2 : index + 6]
        try:
            code_point = int(hexadecimal, 16)
        except ValueError:
            break
        index += 6

        # Wait for the low surrogate before exposing a split Unicode character.
        if 0xD800 <= code_point <= 0xDBFF:
            if index + 6 > len(content) or content[index : index + 2] != "\\u":
                break
            try:
                low_surrogate = int(content[index + 2 : index + 6], 16)
            except ValueError:
                break
            if not 0xDC00 <= low_surrogate <= 0xDFFF:
                break
            code_point = (
                0x10000
                + ((code_point - 0xD800) << 10)
                + (low_surrogate - 0xDC00)
            )
            index += 6
        elif 0xDC00 <= code_point <= 0xDFFF:
            break
        decoded.append(chr(code_point))

    return "".join(decoded)


def parse_json_response(content: str | None) -> dict[str, Any]:
    if not content:
        raise_bad_gateway("LLM returned an empty response")
    cleaned_content = content.strip()
    if cleaned_content.startswith("```") and cleaned_content.endswith("```"):
        cleaned_content = re.sub(r"^```(?:json)?\s*", "", cleaned_content)
        cleaned_content = re.sub(r"\s*```$", "", cleaned_content)
    try:
        payload = json.loads(cleaned_content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LLM returned invalid JSON",
        ) from exc
    if not isinstance(payload, dict):
        raise_bad_gateway("LLM returned a non-object JSON response")
    return payload


def raise_bad_gateway(detail: str) -> None:
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)


def ensure_openai_api_key() -> str:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY must be configured when LLM_PROVIDER is openai",
        )
    return settings.openai_api_key


def ensure_anthropic_api_key() -> str:
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ANTHROPIC_API_KEY must be configured when LLM_PROVIDER is anthropic",
        )
    return settings.anthropic_api_key


def unsupported_provider(provider: str) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=(
            f"Unsupported LLM provider '{provider}'. "
            "Use mock, openai, anthropic, or ollama."
        ),
    )


def get_chat_llm_client() -> ChatLLMClient:
    provider = (settings.chat_llm_provider or settings.llm_provider).lower()
    if provider == "openai":
        return OpenAIChatLLMClient(
            api_key=ensure_openai_api_key(),
            model=settings.openai_chat_model or settings.openai_model,
        )
    if provider == "anthropic":
        return AnthropicChatLLMClient(
            api_key=ensure_anthropic_api_key(),
            model=settings.anthropic_chat_model or settings.anthropic_model,
            max_tokens=settings.anthropic_max_tokens,
        )
    if provider == "ollama":
        return OllamaChatLLMClient(
            base_url=settings.ollama_base_url,
            model=settings.ollama_chat_model or settings.ollama_model,
            timeout_seconds=settings.ollama_timeout_seconds,
            context_window=settings.ollama_context_window,
            max_tokens=settings.ollama_chat_max_tokens,
            num_gpu=settings.ollama_chat_num_gpu,
        )
    if provider in {"mock", "local"}:
        return LocalChatLLMClient()
    unsupported_provider(provider)


def get_topic_llm_client() -> TopicLLMClient:
    provider = (settings.topic_llm_provider or settings.llm_provider).lower()
    if provider == "openai":
        return OpenAITopicLLMClient(
            api_key=ensure_openai_api_key(),
            model=settings.openai_topic_model or settings.openai_model,
        )
    if provider == "anthropic":
        return AnthropicTopicLLMClient(
            api_key=ensure_anthropic_api_key(),
            model=settings.anthropic_topic_model or settings.anthropic_model,
            max_tokens=settings.anthropic_max_tokens,
        )
    if provider == "ollama":
        return OllamaTopicLLMClient(
            base_url=settings.ollama_base_url,
            model=settings.ollama_topic_model or settings.ollama_model,
            timeout_seconds=settings.ollama_timeout_seconds,
            context_window=settings.ollama_context_window,
            max_tokens=settings.ollama_topic_max_tokens,
            num_gpu=settings.ollama_topic_num_gpu,
        )
    if provider in {"mock", "local"}:
        return LocalTopicLLMClient()
    unsupported_provider(provider)


def local_journal_analysis(journal_text: str) -> JournalLLMResult:
    suggestions: list[dict[str, str]] = []
    words = journal_text.split()
    if len(words) >= 20:
        topic = infer_local_freeform_topic([journal_text])
        suggestions.append(
            {
                "kind": "topic",
                "category": "topic",
                "title": topic,
                "text": f"A recurring journal thread concerning {topic.lower()}.",
                "reason": "This theme appears repeatedly in today's journal entry.",
            }
        )
    map_suggestion = LocalChatLLMClient().local_map_suggestion(journal_text)
    if map_suggestion:
        suggestions.append(
            {
                "kind": "map_entry",
                "category": map_suggestion["category"],
                "title": "",
                "text": map_suggestion["text"],
                "reason": map_suggestion["reason"],
            }
        )
    return JournalLLMResult(suggestions=suggestions)


async def analyse_journal_text(journal_text: str, entry_date: str) -> JournalLLMResult:
    """Find optional map candidates without changing the user's confirmed map."""

    provider = (
        settings.journal_llm_provider
        or settings.topic_llm_provider
        or settings.llm_provider
    ).lower()
    request_payload = journal_request_payload(journal_text, entry_date)

    if provider in {"mock", "local"}:
        return local_journal_analysis(journal_text)
    if provider == "openai":
        client = OpenAIBaseClient(
            api_key=ensure_openai_api_key(),
            model=(
                settings.openai_journal_model
                or settings.openai_topic_model
                or settings.openai_model
            ),
        )
        response = await client.client.chat.completions.create(
            model=client.model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": read_system_prompt("journal")},
                {"role": "user", "content": request_payload},
            ],
        )
        return journal_result_from_payload(
            parse_json_response(response.choices[0].message.content)
        )
    if provider == "anthropic":
        client = AnthropicBaseClient(
            api_key=ensure_anthropic_api_key(),
            model=(
                settings.anthropic_journal_model
                or settings.anthropic_topic_model
                or settings.anthropic_model
            ),
            max_tokens=settings.anthropic_max_tokens,
        )
        response = await client.client.messages.create(
            model=client.model,
            max_tokens=client.max_tokens,
            system=read_system_prompt("journal"),
            messages=[{"role": "user", "content": request_payload}],
        )
        return journal_result_from_payload(
            parse_json_response(client.response_text(response))
        )
    if provider == "ollama":
        num_gpu = (
            settings.ollama_journal_num_gpu
            if settings.ollama_journal_num_gpu is not None
            else settings.ollama_topic_num_gpu
        )
        client_options = {
            "base_url": settings.ollama_base_url,
            "model": (
                settings.ollama_journal_model
                or settings.ollama_topic_model
                or settings.ollama_model
            ),
            "timeout_seconds": settings.ollama_timeout_seconds,
            "context_window": settings.ollama_context_window,
            "num_gpu": num_gpu,
        }
        client = OllamaBaseClient(
            **client_options,
            max_tokens=settings.ollama_journal_max_tokens,
        )
        system_prompt = read_system_prompt("journal")
        try:
            payload = await client.request_json(
                system_prompt=system_prompt,
                user_payload=request_payload,
                response_schema=JOURNAL_RESPONSE_SCHEMA,
                temperature=0.2,
            )
            return journal_result_from_payload(payload)
        except HTTPException as exc:
            retryable_details = {
                "LLM returned an empty response",
                "LLM returned invalid JSON",
                "LLM returned a non-object JSON response",
                "Journal-LLM response did not match the expected schema",
            }
            if exc.status_code != status.HTTP_502_BAD_GATEWAY or exc.detail not in retryable_details:
                raise

            retry_max_tokens = min(
                1536,
                max(768, settings.ollama_journal_max_tokens * 2),
            )
            logger.warning(
                "Retrying Ollama journal analysis after an incomplete structured response "
                "with %s output tokens",
                retry_max_tokens,
            )
            retry_client = OllamaBaseClient(
                **client_options,
                max_tokens=retry_max_tokens,
            )
            payload = await retry_client.request_json(
                system_prompt=(
                    f"{system_prompt}\n\nKeep every field concise so the complete JSON object "
                    "fits within the response limit."
                ),
                user_payload=request_payload,
                response_schema=JOURNAL_RESPONSE_SCHEMA,
                temperature=0.1,
            )
            return journal_result_from_payload(payload)
    unsupported_provider(provider)

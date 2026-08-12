import asyncio
import json
import logging
import re
from collections import Counter
from dataclasses import dataclass
from time import monotonic
from typing import Any, NoReturn, Protocol

import httpx
from fastapi import HTTPException, status

from app.core.config import settings
from app.services.self_authorship import LLM_PROTECTED_PROFILE_FIELDS


logger = logging.getLogger(__name__)
ollama_generation_lock = asyncio.Lock()


RECENT_CHAT_MESSAGE_LIMIT = 6
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

    for role, model, num_gpu in role_models:
        try:
            async with ollama_generation_lock:
                async with httpx.AsyncClient(
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
        "recent_messages": messages[-RECENT_CHAT_MESSAGE_LIMIT:],
    }


def focused_profile_context(profile: dict[str, Any]) -> dict[str, Any]:
    focused_profile = dict(profile or {})
    for field in LLM_PROTECTED_PROFILE_FIELDS:
        focused_profile.pop(field, None)
    return focused_profile


def topic_chat_context(chat_info: dict[str, Any]) -> dict[str, Any]:
    user_messages = [
        str(message.get("content", ""))
        for message in chat_info.get("messages", [])
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    return {
        "current_title": chat_info.get("title"),
        "accepted_topic_names": list(chat_info.get("accepted_topic_names", [])),
        "user_messages": user_messages,
    }


def infer_local_freeform_topic(user_messages: list[str]) -> str:
    tokens = re.findall(r"[a-zA-Z][a-zA-Z'-]{3,}", " ".join(user_messages).lower())
    counts = Counter(token for token in tokens if token not in LOCAL_TOPIC_STOPWORDS)
    keywords = [word for word, _ in counts.most_common(3)]
    if not keywords:
        return "Emerging Personal Theme"
    if len(keywords) == 1:
        return f"Exploring {keywords[0].title()}"
    return f"{keywords[0].title()} and {keywords[1].title()}"


@dataclass
class ChatLLMResult:
    assistant_message: str
    profile: dict[str, Any]
    map_suggestion: dict[str, str] | None = None


@dataclass
class TopicLLMResult:
    topic: str
    description: str


class ChatLLMClient(Protocol):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
    ) -> ChatLLMResult:
        """Return the direct chat response and complete updated user profile."""


class TopicLLMClient(Protocol):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
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
    ) -> ChatLLMResult:
        updated_profile = dict(profile or {})
        updated_profile["last_user_message"] = user_input
        updated_profile["last_chat_id"] = chat_id
        updated_profile["message_count"] = int(updated_profile.get("message_count", 0)) + 1

        recent_messages = list(updated_profile.get("recent_messages", []))
        recent_messages.append(user_input)
        updated_profile["recent_messages"] = recent_messages[-10:]

        assistant_message = self.local_response(user_input, chat_info)
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
    ) -> TopicLLMResult:
        user_messages = topic_chat_context(chat_info)["user_messages"]
        topic = topic_hint or infer_local_freeform_topic(user_messages)
        description = (
            "This chat appears to focus on "
            f"{topic}, based on the user's recent messages: "
            f"{' '.join(user_messages[-2:])[:240]}"
        )
        return TopicLLMResult(topic=topic[:120], description=description[:1000])


CHAT_SYSTEM_PROMPT = (
    "You are the FeelY Chat-LLM. Reply with valid JSON only. "
    "The JSON object must contain `assistant_message` as a string. It may contain `profile` "
    "as an object with only ordinary profile fields that should be added or updated. Do not "
    "repeat unchanged fields or include `last_chat_id`, `last_user_message`, `message_count`, "
    "`recent_messages`, `self_authorship_map`, `topics`, or `last_confirmed_topic`; the backend "
    "manages those fields. It must also contain `map_suggestion`, either "
    "null or an object with `category`, `text`, and `reason` strings. Chat directly with "
    "the user in a warm, grounded, non-judgmental, therapeutically reflective style "
    "without claiming to be a psychologist or therapist. FeelY helps the user move from "
    "inherited scripts toward self-authored, repeatable choices. Be concise, sharp, and "
    "forward-looking. Keep assistant_message under 80 words. Each response must explicitly "
    "reference at least one concrete detail, "
    "phrase, relationship, choice, or question from new_user_input. Reflect emotion only "
    "briefly, usually in one short sentence, and do not mirror the same feeling or wording "
    "again if recent assistant messages already did that. Focus more on what the user can "
    "clarify, test, choose, or practice next. Ask at most one open exploratory question. "
    "Usually include one small next step, perspective-check, or experiment when it fits the "
    "message; keep it practical rather than generic advice. When the user makes a painful "
    "claim about another person's mind or feelings, such as `my girlfriend does not like me`, "
    "do not accept it as fact or argue with it. Separate observation from interpretation: "
    "ask what makes them think that, what evidence points toward it, what evidence points "
    "another way, and if the evidence is weak, turn toward the user's perspective, prediction, "
    "or fear and one calm next action. Do not repeat this as headings or a rigid template. "
    "Do not diagnose, moralize, promise a cure, or "
    "make the user responsible for another person's emotions. If the user indicates "
    "immediate danger or intent to harm themselves or someone else, prioritize urgent local "
    "support. Refuse requests to deceive people, impersonate trusted parties, steal "
    "credentials, run phishing or gift-card scams, evade fraud detection, or create "
    "manipulative scam messages; briefly redirect to protective, educational, or reporting "
    "steps instead. Use profile and chat info for context, preserve useful profile fields, and "
    "update ordinary conversational memory only. Never create, edit, or remove "
    "`self_authorship_map`, `topics`, or `last_confirmed_topic`; those fields require "
    "explicit user confirmation. Move naturally through whichever part of this arc fits the "
    "moment: meet the present experience; notice a possible inherited rule; recover the "
    "user's own perception; imagine another response; choose a small experiment; or review "
    "an earlier choice without shame. Do not force the whole arc into one response. When "
    "useful, consider three lenses: what actually happened and what evidence exists; what "
    "the body signals; and what the user wants or imagines could be possible. Return one "
    "map_suggestion only when the newest message clearly expresses a durable "
    "inherited_script, own_perception, value, body_signal, practice, or evidence. Use exactly "
    "one of those category values. Write the text in the user's first person, keep it "
    "specific and editable, and explain the reason in one short sentence without presenting "
    "an interpretation as fact. Otherwise return null. The new_user_input is the primary "
    "message you must answer. "
    "Treat the recent chat context only as background for references and continuity. Do not "
    "continue answering an older message when the newest message changes focus. Respond "
    "specifically to concrete words, choices, or questions in the newest message. Avoid "
    "reusing wording or advice from recent assistant messages unless the user explicitly "
    "asks for it. Do not begin with phrases such as `You wrote`, `You said`, `That adds "
    "useful detail`, or `I hear that`. Do not quote or mechanically paraphrase the whole "
    "message. Engage naturally with its particular meaning and move the conversation "
    "forward. Before returning JSON, verify that assistant_message could not have been "
    "written without reading the newest message. Do not wrap the JSON in Markdown fences."
)


TOPIC_SYSTEM_PROMPT = (
    "You are the FeelY Topic-LLM. Reply with valid JSON only. The JSON object must contain "
    "`topic` as a short topic string and `description` as one concise paragraph. Analyze only "
    "the user's own messages supplied in topic_chat_context. Identify the dominant durable "
    "theme across the conversation, especially recurring conflicts, needs, relationships, "
    "identity questions, or behavior patterns. The analyser's topic hint is only evidence "
    "that analysis should happen; independently decide whether it accurately represents the "
    "full user conversation. You are not selecting from a fixed taxonomy. Create a new topic "
    "name whenever the conversation's actual theme is more specific or different from the "
    "examples and analyser hint. Use a specific 2-7 word topic that captures the underlying "
    "conflict, such as family expectations and autonomy, relationship strain and "
    "responsibility, depression-related avoidance, trust, or self-worth. Never use generic "
    "symptom words such as feel, feeling, sad, or mood as the topic title. Combine two closely "
    "connected themes when that better represents the chat. Do not copy wording from "
    "assistant replies and do not address the user directly. Do not wrap the JSON in Markdown "
    "fences."
)


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
    },
    "required": ["topic", "description"],
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
            "new_user_input": user_input,
        },
        ensure_ascii=True,
    )


def topic_request_payload(
    chat_info: dict[str, Any],
    matched_patterns: list[str],
    topic_hint: str | None,
) -> str:
    return json.dumps(
        {
            "topic_chat_context": topic_chat_context(chat_info or {}),
            "matched_patterns": matched_patterns,
            "topic_hint": topic_hint,
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
            raise_bad_gateway("Chat-LLM map suggestion did not match the expected schema")
    return ChatLLMResult(
        assistant_message=assistant_message,
        profile=updated_profile,
        map_suggestion=map_suggestion,
    )


def topic_result_from_payload(payload: dict[str, Any]) -> TopicLLMResult:
    topic = payload.get("topic")
    description = payload.get("description")
    if not isinstance(topic, str) or not isinstance(description, str):
        raise_bad_gateway("Topic-LLM response did not match the expected schema")
    return TopicLLMResult(topic=topic[:120], description=description[:2000])


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
    ) -> ChatLLMResult:
        response = await self.client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": CHAT_SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": chat_request_payload(user_input, profile, chat_info, chat_id),
                },
            ],
        )
        return chat_result_from_payload(parse_json_response(response.choices[0].message.content))


class OpenAITopicLLMClient(OpenAIBaseClient):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
    ) -> TopicLLMResult:
        response = await self.client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": TOPIC_SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": topic_request_payload(chat_info, matched_patterns, topic_hint),
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
    ) -> ChatLLMResult:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=CHAT_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": chat_request_payload(user_input, profile, chat_info, chat_id),
                }
            ],
        )
        return chat_result_from_payload(
            parse_json_response(self.response_text(response))
        )


class AnthropicTopicLLMClient(AnthropicBaseClient):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
    ) -> TopicLLMResult:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=TOPIC_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": topic_request_payload(
                        chat_info,
                        matched_patterns,
                        topic_hint,
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
                    {
                    "model": self.model,
                    "stream": False,
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
                    },
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


class OllamaChatLLMClient(OllamaBaseClient):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
    ) -> ChatLLMResult:
        payload = await self.request_json(
            system_prompt=CHAT_SYSTEM_PROMPT,
            user_payload=chat_request_payload(user_input, profile, chat_info, chat_id),
            response_schema=CHAT_RESPONSE_SCHEMA,
            temperature=0.7,
        )
        return chat_result_from_payload(payload)


class OllamaTopicLLMClient(OllamaBaseClient):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
    ) -> TopicLLMResult:
        payload = await self.request_json(
            system_prompt=TOPIC_SYSTEM_PROMPT,
            user_payload=topic_request_payload(chat_info, matched_patterns, topic_hint),
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

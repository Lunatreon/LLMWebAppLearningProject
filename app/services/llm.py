import json
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Protocol

from fastapi import HTTPException, status

from app.core.config import settings


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


def current_message_focus(user_input: str) -> str:
    words = " ".join(user_input.strip().split()).strip(" .,!?:;#").split()
    if not words:
        return "what you just shared"
    focus = " ".join(words[:LOCAL_FOCUS_WORD_LIMIT])
    if len(words) > LOCAL_FOCUS_WORD_LIMIT:
        focus += "..."
    return focus


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
    if "recent_messages" in focused_profile:
        focused_profile["recent_messages"] = list(focused_profile["recent_messages"])[-3:]
    focused_profile.pop("last_user_message", None)
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
        return ChatLLMResult(assistant_message=assistant_message, profile=updated_profile)

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
                "You connect walking with a mental reset, while progress on the thesis feels "
                "like evidence against your parents' prediction. I wonder whether one restores "
                "you and the other asks you to prove yourself. What would it be like to choose "
                "based on care for yourself rather than on winning that argument today?"
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
                    "content": (
                        "You are the FeelY Chat-LLM. Reply with valid JSON only. "
                        "The JSON object must contain `assistant_message` as a string and "
                        "`profile` as the complete updated user profile object. Chat directly "
                        "with the user in a warm, grounded, non-judgmental, therapeutically "
                        "reflective style without claiming to be a psychologist or therapist. "
                        "Each response must explicitly reference at least one concrete detail, "
                        "phrase, relationship, choice, or question from new_user_input. Briefly "
                        "reflect the emotion, conflict, or need connected to that detail. Ask "
                        "one open exploratory question that could help the user understand the "
                        "current experience more clearly. Offer a concrete next step only when "
                        "it follows naturally from the current message; do not force advice into "
                        "every reply. Do not repeat this as headings or a rigid template. Do "
                        "not diagnose, moralize, promise a cure, or make the user responsible "
                        "for another person's emotions. If the user indicates immediate danger "
                        "or intent to harm themselves or someone else, prioritize urgent local "
                        "support. Use profile and chat info for context, preserve useful profile "
                        "fields, and update durable user information only. "
                        "The new_user_input is the primary message you must answer. Treat the "
                        "recent chat context only as background for references and continuity. "
                        "Do not continue answering an older message when the newest message "
                        "changes focus. Respond specifically to concrete words, choices, or "
                        "questions in the newest message. Avoid reusing wording or advice from "
                        "recent assistant messages unless the user explicitly asks for it. "
                        "Do not begin with phrases such as `You wrote`, `You said`, `That adds "
                        "useful detail`, or `I hear that`. Do not quote or mechanically "
                        "paraphrase the whole message. Engage naturally with its particular "
                        "meaning and move the conversation forward. "
                        "Before returning JSON, verify that assistant_message could not have "
                        "been written without reading the newest message."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "chat_id": chat_id,
                            "current_profile": focused_profile_context(profile or {}),
                            "recent_chat_context": focused_chat_context(chat_info or {}),
                            "new_user_input": user_input,
                        },
                        ensure_ascii=True,
                    ),
                },
            ],
        )
        payload = parse_json_response(response.choices[0].message.content)
        assistant_message = payload.get("assistant_message")
        updated_profile = payload.get("profile")
        if not isinstance(assistant_message, str) or not isinstance(updated_profile, dict):
            raise_bad_gateway("Chat-LLM response did not match the expected schema")
        return ChatLLMResult(assistant_message=assistant_message, profile=updated_profile)


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
                    "content": (
                        "You are the FeelY Topic-LLM. Reply with valid JSON only. "
                        "The JSON object must contain `topic` as a short topic string and "
                        "`description` as one concise paragraph. Analyze only the user's own "
                        "messages supplied in topic_chat_context. Identify the dominant durable "
                        "theme across the conversation, especially recurring conflicts, needs, "
                        "relationships, identity questions, or behavior patterns. The analyser's "
                        "topic hint is only evidence that analysis should happen; independently "
                        "decide whether it accurately represents the full user conversation. "
                        "You are not selecting from a fixed taxonomy. Create a new topic name "
                        "whenever the conversation's actual theme is more specific or different "
                        "from the examples and analyser hint. "
                        "Use a specific 2-7 word topic that captures the underlying conflict, "
                        "such as family expectations and autonomy, relationship strain and "
                        "responsibility, depression-related avoidance, trust, or self-worth. "
                        "Never use generic symptom words such as feel, feeling, sad, or mood as "
                        "the topic title. Combine two closely connected themes when that better "
                        "represents the chat. Do not copy wording from assistant replies and do "
                        "not address the user directly."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "topic_chat_context": topic_chat_context(chat_info or {}),
                            "matched_patterns": matched_patterns,
                            "topic_hint": topic_hint,
                        },
                        ensure_ascii=True,
                    ),
                },
            ],
        )
        payload = parse_json_response(response.choices[0].message.content)
        topic = payload.get("topic")
        description = payload.get("description")
        if not isinstance(topic, str) or not isinstance(description, str):
            raise_bad_gateway("Topic-LLM response did not match the expected schema")
        return TopicLLMResult(topic=topic[:120], description=description[:2000])


def parse_json_response(content: str | None) -> dict[str, Any]:
    if not content:
        raise_bad_gateway("LLM returned an empty response")
    try:
        payload = json.loads(content)
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


def get_chat_llm_client() -> ChatLLMClient:
    provider = (settings.chat_llm_provider or settings.llm_provider).lower()
    if provider == "openai":
        return OpenAIChatLLMClient(
            api_key=ensure_openai_api_key(),
            model=settings.openai_chat_model or settings.openai_model,
        )
    return LocalChatLLMClient()


def get_topic_llm_client() -> TopicLLMClient:
    provider = (settings.topic_llm_provider or settings.llm_provider).lower()
    if provider == "openai":
        return OpenAITopicLLMClient(
            api_key=ensure_openai_api_key(),
            model=settings.openai_topic_model or settings.openai_model,
        )
    return LocalTopicLLMClient()

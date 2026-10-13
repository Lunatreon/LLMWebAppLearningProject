"""Deterministic development providers; no external API calls."""

import re
from typing import Any

from app.llm.context import topic_chat_context
from app.llm.types import (
    ChatLLMResult,
    JournalLLMResult,
    TextChunkCallback,
    TopicLLMResult,
)
from app.llm.tasks.topic_matching import infer_local_freeform_topic

LOCAL_FOCUS_WORD_LIMIT = 14


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
            map_suggestion=None,
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

        if any(
            phrase in text for phrase in ("writing about it", "writting about it", "write about it")
        ):
            return (
                "Writing seems to be giving you enough distance to notice what is happening "
                "without immediately handing the distress to someone else. You do not need to "
                "solve everything while you write; naming the feeling and the urge that follows "
                "it can already help you choose what to do next. What becomes clearer when you "
                "write it here than when you hold it in your head?"
            )

        if any(
            phrase in text
            for phrase in ("other people handle", "handle my distress", "handle my disstress")
        ):
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
        from app.llm.tasks.pattern_recognition import ChatAnalyser

        # The offline fallback has no model to judge evidence; keep its
        # conservative heuristic without blocking actual LLM suggestions.
        topic = (
            (topic_hint or infer_local_freeform_topic(user_messages))
            if (
                chat_info.get("suggest_topics", True)
                and ChatAnalyser().analyse(chat_info).should_create_topic
            )
            else ""
        )
        description = (
            "This chat appears to focus on "
            f"{topic}, based on the user's recent messages: "
            f"{' '.join(user_messages[-2:])[:240]}"
        )
        return TopicLLMResult(
            topic=topic[:120],
            description=description[:1000] if topic else "",
            map_suggestion=(
                LocalChatLLMClient().local_map_suggestion(user_messages[-1])
                if user_messages
                else None
            ),
        )


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

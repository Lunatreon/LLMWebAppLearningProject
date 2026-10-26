import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PATTERN_FILE = Path(__file__).resolve().parents[1] / "pattern_recognition.txt"
MIN_USER_MESSAGES = 3
MIN_USER_WORDS = 20
OPEN_TOPIC_MIN_MESSAGES = 4
OPEN_TOPIC_MIN_WORDS = 50
OPEN_TOPIC_LONG_TEXT_WORDS = 140


@dataclass(frozen=True)
class PatternRule:
    topic_hint: str
    threshold: int
    patterns: list[str]


@dataclass(frozen=True)
class AnalysisResult:
    should_create_topic: bool
    confidence: float
    matched_patterns: list[str]
    topic_hint: str | None = None


class ChatAnalyser:
    """Hard-coded analyser that scores chats with backend pattern rules."""

    def __init__(self, pattern_file: Path = PATTERN_FILE) -> None:
        self.pattern_file = pattern_file

    def analyse(self, chat_info: dict[str, Any]) -> AnalysisResult:
        rules = self.load_rules()
        user_messages = self.user_messages(chat_info)
        text = " ".join(user_messages).lower()
        word_count = len(text.split())
        if len(user_messages) < MIN_USER_MESSAGES or word_count < MIN_USER_WORDS:
            return AnalysisResult(False, 0.0, [])

        best_result = AnalysisResult(False, 0.0, [])
        best_strength = 0.0
        for rule in rules:
            matched = [
                pattern
                for pattern in rule.patterns
                if re.search(rf"(?<!\w){re.escape(pattern)}(?!\w)", text)
            ]
            if len(matched) < rule.threshold:
                continue

            confidence = min(1.0, len(matched) / max(rule.threshold, len(rule.patterns)))
            strength = len(matched) / rule.threshold
            candidate = AnalysisResult(
                should_create_topic=True,
                confidence=round(confidence, 2),
                matched_patterns=matched,
                topic_hint=rule.topic_hint,
            )
            if strength > best_strength:
                best_result = candidate
                best_strength = strength

        if best_result.should_create_topic:
            return best_result

        open_topic_ready = (
            len(user_messages) >= OPEN_TOPIC_MIN_MESSAGES and word_count >= OPEN_TOPIC_MIN_WORDS
        ) or (len(user_messages) >= MIN_USER_MESSAGES and word_count >= OPEN_TOPIC_LONG_TEXT_WORDS)
        if open_topic_ready:
            return AnalysisResult(
                should_create_topic=True,
                confidence=0.25,
                matched_patterns=["open-topic-analysis"],
                topic_hint=None,
            )

        return best_result

    def load_rules(self) -> list[PatternRule]:
        if not self.pattern_file.exists():
            return []

        rules: list[PatternRule] = []
        for line in self.pattern_file.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue

            parts = [part.strip() for part in stripped.split("|", maxsplit=2)]
            if len(parts) != 3:
                continue

            topic_hint, threshold_text, patterns_text = parts
            try:
                threshold = int(threshold_text)
            except ValueError:
                continue

            patterns = [
                pattern.strip().lower() for pattern in patterns_text.split(",") if pattern.strip()
            ]
            if topic_hint and threshold > 0 and patterns:
                rules.append(
                    PatternRule(
                        topic_hint=topic_hint,
                        threshold=threshold,
                        patterns=patterns,
                    )
                )

        return rules

    def user_messages(self, chat_info: dict[str, Any]) -> list[str]:
        messages = chat_info.get("messages", [])
        return [
            str(message.get("content", ""))
            for message in messages
            if isinstance(message, dict) and message.get("role") == "user"
        ]

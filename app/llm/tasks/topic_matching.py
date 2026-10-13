"""Conservative topic matching and deterministic development topic names."""

import re
from collections import Counter
from typing import Any

from app.services.self_authorship import normalize_topic_category

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
            len(shared_title) >= 2 and (len(shared_all) >= 3 or title_coverage >= 0.6)
        ) or (len(shared_title) >= 1 and len(shared_all) >= 4 and title_coverage >= 0.25)
        if not is_clear_match:
            continue

        score = (len(shared_title) * 4) + len(shared_all) + title_coverage
        if score > best_score:
            best_match_id = candidate_id
            best_score = score

    return best_match_id

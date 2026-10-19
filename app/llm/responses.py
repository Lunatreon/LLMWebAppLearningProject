"""Structured response schemas and validation shared by all providers."""

import logging
from typing import Any

from app.llm.json_response import raise_bad_gateway
from app.llm.types import ChatLLMResult, TopicLLMResult
from app.services.self_authorship import normalize_topic_category

logger = logging.getLogger(__name__)


MAP_SUGGESTION_CATEGORIES = (
    "inherited_script",
    "own_perception",
    "value",
    "body_signal",
    "practice",
    "evidence",
)

MAP_SUGGESTION_SCHEMA = {
    "anyOf": [
        {"type": "null"},
        {
            "type": "object",
            "properties": {
                "category": {"type": "string", "enum": list(MAP_SUGGESTION_CATEGORIES)},
                "text": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["category", "text", "reason"],
            "additionalProperties": False,
        },
    ],
}


CHAT_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {"assistant_message": {"type": "string"}},
    "required": ["assistant_message"],
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
                    "category": {
                        "type": "string",
                        "enum": ["person", "trait", "experience", "other"],
                    },
                    "related_topic_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 24,
                    },
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


TOPIC_RESPONSE_SCHEMA["properties"]["map_suggestion"] = MAP_SUGGESTION_SCHEMA


TOPIC_RESPONSE_SCHEMA["required"].append("map_suggestion")


def map_suggestion_from_payload(value: Any) -> dict[str, str] | None:
    """Discard malformed optional suggestions without losing a valid response."""
    if value is None:
        return None
    if (
        not isinstance(value, dict)
        or value.get("category") not in MAP_SUGGESTION_CATEGORIES
        or not isinstance(value.get("text"), str)
        or not isinstance(value.get("reason"), str)
    ):
        logger.warning("Discarding a malformed optional LLM map suggestion")
        return None
    return value


def chat_result_from_payload(payload: dict[str, Any]) -> ChatLLMResult:
    assistant_message = payload.get("assistant_message")
    updated_profile = payload.get("profile")
    if not isinstance(assistant_message, str) or not assistant_message.strip():
        raise_bad_gateway("Chat-LLM response did not match the expected schema")
    if not isinstance(updated_profile, dict):
        updated_profile = {}
    return ChatLLMResult(
        assistant_message=assistant_message,
        profile=updated_profile,
        map_suggestion=map_suggestion_from_payload(payload.get("map_suggestion")),
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
        map_suggestion=map_suggestion_from_payload(payload.get("map_suggestion")),
    )

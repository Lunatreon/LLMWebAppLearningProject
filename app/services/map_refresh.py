"""Reviewable upgrades of existing map topics, without replacing their contents."""
import hashlib
import json
from typing import Any

from fastapi import HTTPException

from app.services.llm.anthropic import AnthropicBaseClient
from app.services.llm.factory import get_topic_llm_client
from app.services.llm.json_response import parse_json_response
from app.services.llm.ollama import OllamaBaseClient
from app.services.llm.openai import OpenAIBaseClient
from app.services.prompts import read_system_prompt
from app.services.self_authorship import MAP_KEY, TOPIC_CATEGORIES, read_map, write_map


def map_revision(profile: dict[str, Any]) -> str:
    raw = json.dumps(profile.get(MAP_KEY, {}), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def suggest_topic_refresh(topic: dict[str, Any]) -> dict[str, str]:
    client = get_topic_llm_client()
    system_prompt = read_system_prompt("map_refresh")
    # These are saved topic notes, not verbatim user chat messages.
    user_payload = json.dumps({
        "saved_topic": {key: topic.get(key) for key in ("title", "description", "category")},
        "saved_observations": [
            {"category": entry.get("category"), "text": str(entry.get("text", ""))[:1000]}
            for entry in topic.get("entries", [])[:8]
        ],
    }, ensure_ascii=False)
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "category": {"type": "string", "enum": sorted(TOPIC_CATEGORIES)},
        },
        "required": ["title", "description", "category"],
        "additionalProperties": False,
    }
    if isinstance(client, OllamaBaseClient):
        payload = await client.request_json(
            system_prompt=system_prompt, user_payload=user_payload,
            response_schema=schema, temperature=0.1,
        )
    elif isinstance(client, OpenAIBaseClient):
        response = await client.client.chat.completions.create(
            model=client.model, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system_prompt},
                      {"role": "user", "content": user_payload}],
        )
        payload = parse_json_response(response.choices[0].message.content)
    elif isinstance(client, AnthropicBaseClient):
        response = await client.client.messages.create(
            model=client.model, max_tokens=client.max_tokens, system=system_prompt,
            messages=[{"role": "user", "content": user_payload}],
        )
        payload = parse_json_response(client.response_text(response))
    else:
        raise HTTPException(503, "AI preview needs an Ollama, OpenAI, or Anthropic topic model. You can still edit topics manually.")
    if (
        not isinstance(payload.get("title"), str)
        or not payload["title"].strip()
        or len(payload["title"].strip()) > 120
        or not isinstance(payload.get("description"), str)
        or not payload["description"].strip()
        or len(payload["description"].strip()) > 2000
        or not isinstance(payload.get("category"), str)
        or payload["category"] not in TOPIC_CATEGORIES
    ):
        raise HTTPException(502, "The topic model returned an invalid preview. Nothing was changed; try again.")
    return {key: payload[key].strip() for key in ("title", "description", "category")}


def apply_topic_refresh(profile: dict[str, Any], revision: str, updates: list[dict]) -> dict:
    if map_revision(profile) != revision:
        raise HTTPException(409, "Your map changed after this preview. Generate a fresh preview before applying it.")
    map_data = read_map(profile)
    by_id = {topic["id"]: topic for topic in map_data["topic_spaces"]}
    seen = set()
    for update in updates:
        topic_id = update["id"]
        if topic_id in seen or topic_id not in by_id:
            raise HTTPException(400, "The preview contains a duplicate or missing topic. Nothing was changed.")
        seen.add(topic_id)
        title = update["title"].strip()
        if not title:
            raise HTTPException(400, "Every topic needs a name. Nothing was changed.")
        # Change only presentation fields; preserve links, observations and provenance.
        by_id[topic_id].update(title=title, description=update["description"], category=update["category"])
    return write_map(profile, map_data)

"""Decode completed provider responses and normalize upstream errors."""

import json
import re
from typing import Any

from fastapi import HTTPException, status


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

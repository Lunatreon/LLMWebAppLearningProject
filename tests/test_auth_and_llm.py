import asyncio
import json
from types import SimpleNamespace

import pytest

from app.api.routes.llm import (
    remember_map_suggestion_event,
    should_surface_map_suggestion,
)
from app.core import captcha as captcha_module
from app.core.config import settings
from app.services.llm import (
    AnthropicChatLLMClient,
    AnthropicTopicLLMClient,
    CHAT_SYSTEM_PROMPT,
    LocalChatLLMClient,
    OllamaChatLLMClient,
    OllamaTopicLLMClient,
    chat_result_from_payload,
    focused_chat_context,
    focused_profile_context,
    get_chat_llm_client,
    get_topic_llm_client,
    infer_local_freeform_topic,
    is_scam_abuse_request,
    parse_json_response,
    topic_chat_context,
)
from app.services.pattern_recognition import ChatAnalyser
from app.services.self_authorship import merge_llm_profile


def test_local_website_cors_preflight(client):
    response = client.options(
        "/api/v1/auth/register",
        headers={
            "Origin": "http://127.0.0.1:5500",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5500"


def test_user_can_register_login_and_send_llm_message(client):
    register_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "luna@example.com",
            "username": "luna",
            "password": "super-secret",
        },
    )
    assert register_response.status_code == 201
    assert register_response.json()["email"] == "luna@example.com"

    login_response = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "luna@example.com", "password": "super-secret"},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    create_chat_response = client.post(
        "/api/v1/llm/chats",
        json={"title": "Cozy work"},
        headers=headers,
    )
    assert create_chat_response.status_code == 201
    chat_id = create_chat_response.json()["chat_id"]

    llm_response = client.post(
        "/api/v1/llm/message",
        json={
            "chat_id": chat_id,
            "context": "I love building cozy productivity apps and finishing projects.",
        },
        headers=headers,
    )

    assert llm_response.status_code == 200
    body = llm_response.json()
    assert "assistant_message" in body
    assert body["chat_id"] == chat_id
    assert body["chat_info"]["message_count"] == 1
    assert body["profile"]["message_count"] == 1
    assert (
        body["profile"]["last_user_message"]
        == "I love building cozy productivity apps and finishing projects."
    )

    chats_response = client.get("/api/v1/llm/chats", headers=headers)
    assert chats_response.status_code == 200
    assert chats_response.json()[0]["chat_id"] == chat_id

    early_suggestion_response = client.get(
        f"/api/v1/llm/chats/{chat_id}/topic-suggestion",
        headers=headers,
    )
    assert early_suggestion_response.status_code == 200
    assert early_suggestion_response.json()["suggestion"] is None

    assistant_messages = [body["assistant_message"]]
    for context in [
        "I am planning the project carefully and keeping each task manageable.",
        "My goal is to improve the workflow so I can focus before the deadline.",
    ]:
        follow_up_response = client.post(
            "/api/v1/llm/message",
            json={"chat_id": chat_id, "context": context},
            headers=headers,
        )
        assert follow_up_response.status_code == 200
        assistant_messages.append(follow_up_response.json()["assistant_message"])

    assert len(set(assistant_messages)) > 1

    suggestion_response = client.get(
        f"/api/v1/llm/chats/{chat_id}/topic-suggestion",
        headers=headers,
    )
    assert suggestion_response.status_code == 200
    suggestion = suggestion_response.json()["suggestion"]
    assert suggestion["chat_id"] == chat_id
    assert "productivity" in suggestion["topic"]
    assert suggestion["description"]

    confirm_response = client.post(
        "/api/v1/llm/topics/confirm",
        json={
            "chat_id": chat_id,
            "topic": suggestion["topic"],
            "description": suggestion["description"],
            "accepted": True,
        },
        headers=headers,
    )
    assert confirm_response.status_code == 200
    profile = confirm_response.json()["profile"]
    assert profile["topics"][0]["topic"] == suggestion["topic"]
    topic_spaces = profile["self_authorship_map"]["topic_spaces"]
    assert topic_spaces[0]["title"] == suggestion["topic"]
    assert topic_spaces[0]["chat_ids"] == [chat_id]

    updated_chat_response = client.get(f"/api/v1/llm/chats/{chat_id}", headers=headers)
    assert updated_chat_response.status_code == 200
    assert updated_chat_response.json()["title"] == suggestion["topic"]

    message_after_acceptance = client.post(
        "/api/v1/llm/message",
        json={
            "chat_id": chat_id,
            "context": "I will keep working on the same project goal and workflow.",
        },
        headers=headers,
    )
    assert message_after_acceptance.status_code == 200

    repeated_suggestion_response = client.get(
        f"/api/v1/llm/chats/{chat_id}/topic-suggestion",
        headers=headers,
    )
    assert repeated_suggestion_response.status_code == 200
    assert repeated_suggestion_response.json()["suggestion"] is None


def test_registration_rejects_filled_honeypot(client):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "bot@example.com",
            "username": "bot_user",
            "password": "super-secret",
            "website": "https://spam.example",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Could not create account"


def test_registration_requires_captcha_when_enabled(client, monkeypatch):
    monkeypatch.setattr(settings, "captcha_enabled", True)
    monkeypatch.setattr(settings, "turnstile_site_key", "test-site-key")
    monkeypatch.setattr(settings, "turnstile_secret_key", "test-secret-key")

    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "captcha-missing@example.com",
            "username": "captcha_missing",
            "password": "super-secret",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Please complete the verification before creating an account."
    )


def test_registration_accepts_verified_captcha_token(client, monkeypatch):
    class SuccessfulTurnstileClient:
        def __init__(self, timeout):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def post(self, url, data):
            assert data["secret"] == "test-secret-key"
            assert data["response"] == "verified-token"
            return SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {"success": True},
            )

    monkeypatch.setattr(settings, "captcha_enabled", True)
    monkeypatch.setattr(settings, "turnstile_site_key", "test-site-key")
    monkeypatch.setattr(settings, "turnstile_secret_key", "test-secret-key")
    monkeypatch.setattr(captcha_module.httpx, "Client", SuccessfulTurnstileClient)

    config_response = client.get("/api/v1/auth/captcha/config")
    assert config_response.status_code == 200
    assert config_response.json() == {
        "enabled": True,
        "provider": "turnstile",
        "site_key": "test-site-key",
    }

    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "captcha-ok@example.com",
            "username": "captcha_ok",
            "password": "super-secret",
            "captcha_token": "verified-token",
        },
    )

    assert response.status_code == 201
    assert response.json()["email"] == "captcha-ok@example.com"


def test_login_attempts_are_rate_limited_by_identifier(client, monkeypatch):
    client.post(
        "/api/v1/auth/register",
        json={
            "email": "limited@example.com",
            "username": "limited_user",
            "password": "super-secret",
        },
    )
    monkeypatch.setattr(settings, "rate_limit_login_identifier_attempts", 2)
    monkeypatch.setattr(settings, "rate_limit_login_identifier_window_seconds", 60)

    payload = {"email_or_username": "limited@example.com", "password": "wrong-secret"}
    assert client.post("/api/v1/auth/login", json=payload).status_code == 401
    assert client.post("/api/v1/auth/login", json=payload).status_code == 401
    limited_response = client.post("/api/v1/auth/login", json=payload)

    assert limited_response.status_code == 429
    assert "Retry-After" in limited_response.headers


def test_production_runtime_requires_secure_defaults(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "secret_key", "change-this-secret-before-deploying")

    with pytest.raises(RuntimeError):
        settings.validate_runtime_security()


def test_user_can_confirm_map_suggestion_and_complete_practice(client):
    client.post(
        "/api/v1/auth/register",
        json={
            "email": "map@example.com",
            "username": "map_user",
            "password": "super-secret",
        },
    )
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "map@example.com", "password": "super-secret"},
    )
    headers = {"Authorization": f"Bearer {login_response.json()['access_token']}"}

    message_response = client.post(
        "/api/v1/llm/message",
        json={
            "context": (
                "My parents told me to choose safety and obedience, and I still feel "
                "judged when I make my own decisions. It keeps showing up in my body "
                "when I need to choose something for myself, because a part of me still "
                "expects punishment or rejection if I disappoint them."
            )
        },
        headers=headers,
    )
    assert message_response.status_code == 200
    body = message_response.json()
    suggestion = body["map_suggestion"]
    assert suggestion["category"] == "inherited_script"
    assert body["chat_info"]["pending_map_suggestion"] == suggestion

    confirm_response = client.post(
        "/api/v1/llm/map-suggestions/confirm",
        json={
            "chat_id": body["chat_id"],
            "accepted": True,
            "category": suggestion["category"],
            "text": suggestion["text"],
            "reason": suggestion["reason"],
        },
        headers=headers,
    )
    assert confirm_response.status_code == 200
    assert confirm_response.json()["entry"]["category"] == "inherited_script"

    practice_response = client.post(
        "/api/v1/users/me/map/entries",
        json={
            "category": "practice",
            "text": "Pause and name my own preference before asking what others expect.",
            "source_chat_id": body["chat_id"],
        },
        headers=headers,
    )
    assert practice_response.status_code == 200
    practice = practice_response.json()["entry"]
    assert practice["status"] == "active"

    complete_response = client.patch(
        f"/api/v1/users/me/map/practices/{practice['id']}",
        json={
            "status": "completed",
            "reflection": "I noticed my preference before calling my family.",
        },
        headers=headers,
    )
    assert complete_response.status_code == 200
    completed = complete_response.json()["practice"]
    assert completed["status"] == "completed"
    assert completed["reflection"].startswith("I noticed")

    map_response = client.get("/api/v1/users/me/map", headers=headers)
    assert map_response.status_code == 200
    entries = map_response.json()["unassigned_entries"]
    assert {entry["category"] for entry in entries} == {"inherited_script", "practice"}


def test_user_can_edit_and_delete_map_entry(client):
    client.post(
        "/api/v1/auth/register",
        json={
            "email": "entry@example.com",
            "username": "entry_user",
            "password": "super-secret",
        },
    )
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "entry_user", "password": "super-secret"},
    )
    headers = {"Authorization": f"Bearer {login_response.json()['access_token']}"}

    create_response = client.post(
        "/api/v1/users/me/map/entries",
        json={"category": "value", "text": "Clarity matters to me."},
        headers=headers,
    )
    assert create_response.status_code == 200
    entry_id = create_response.json()["entry"]["id"]

    update_response = client.patch(
        f"/api/v1/users/me/map/entries/{entry_id}",
        json={"category": "own_perception", "text": "I need clearer language."},
        headers=headers,
    )
    assert update_response.status_code == 200
    updated_entry = update_response.json()["entry"]
    assert updated_entry["category"] == "own_perception"
    assert updated_entry["text"] == "I need clearer language."

    delete_response = client.delete(
        f"/api/v1/users/me/map/entries/{entry_id}",
        headers=headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] is True
    assert delete_response.json()["map"]["unassigned_entries"] == []


def test_user_can_create_and_rename_map_topic(client):
    client.post(
        "/api/v1/auth/register",
        json={
            "email": "topic-edit@example.com",
            "username": "topic_edit_user",
            "password": "super-secret",
        },
    )
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "topic_edit_user", "password": "super-secret"},
    )
    headers = {"Authorization": f"Bearer {login_response.json()['access_token']}"}

    create_response = client.post(
        "/api/v1/users/me/map/topics",
        json={"title": "Boundaries", "description": "Where I notice limits."},
        headers=headers,
    )
    assert create_response.status_code == 200
    topic = create_response.json()["topic"]
    assert topic["title"] == "Boundaries"
    assert topic["description"] == "Where I notice limits."
    assert create_response.json()["map"]["topic_spaces"][0]["id"] == topic["id"]

    update_response = client.patch(
        f"/api/v1/users/me/map/topics/{topic['id']}",
        json={"title": "Clear boundaries"},
        headers=headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["topic"]["title"] == "Clear boundaries"
    assert update_response.json()["map"]["topic_spaces"][0]["title"] == "Clear boundaries"

    entry_response = client.post(
        "/api/v1/users/me/map/entries",
        json={
            "category": "value",
            "text": "I can name my limit.",
            "topic_space_id": topic["id"],
        },
        headers=headers,
    )
    assert entry_response.status_code == 200

    delete_response = client.delete(
        f"/api/v1/users/me/map/topics/{topic['id']}",
        headers=headers,
    )
    assert delete_response.status_code == 200
    deleted_map = delete_response.json()["map"]
    assert deleted_map["topic_spaces"] == []
    assert deleted_map["unassigned_entries"][0]["text"] == "I can name my limit."


def test_map_suggestions_use_hybrid_surface_rule():
    suggestion = {
        "category": "body_signal",
        "text": "My chest tightens when I imagine disappointing her.",
    }

    assert not should_surface_map_suggestion({"message_count": 0}, "that feels scary", suggestion)
    assert should_surface_map_suggestion({"message_count": 2}, "still scary", suggestion)
    assert should_surface_map_suggestion(
        {"message_count": 0},
        (
            "When I imagine disappointing her, my chest tightens and my thoughts start "
            "racing because it feels like one imperfect sentence could make everything "
            "fragile between us."
        ),
        suggestion,
    )

    shown_info = remember_map_suggestion_event(
        {"message_count": 3},
        "last_surface_map_suggestion",
        suggestion,
    )
    similar_suggestion = {
        "category": "body_signal",
        "text": "My chest gets tight whenever I picture disappointing her.",
    }
    assert not should_surface_map_suggestion(
        shown_info,
        "This is a long message that would normally be enough to save into the map.",
        similar_suggestion,
    )

    dismissed_info = remember_map_suggestion_event(
        {"message_count": 5},
        "last_dismissed_map_suggestion",
        suggestion,
    )
    assert not should_surface_map_suggestion(
        dismissed_info,
        "This keeps showing up strongly in my body and thoughts.",
        suggestion,
    )


def test_llm_profile_merge_preserves_user_confirmed_map():
    current = {
        "message_count": 2,
        "topics": [{"topic": "Autonomy"}],
        "self_authorship_map": {"topic_spaces": [{"id": "confirmed"}]},
    }
    generated = {
        "message_count": 3,
        "topics": [],
        "self_authorship_map": {"topic_spaces": []},
    }

    merged = merge_llm_profile(current, generated)

    assert merged["message_count"] == 2
    assert merged["topics"] == current["topics"]
    assert merged["self_authorship_map"] == current["self_authorship_map"]


def test_chat_result_accepts_missing_or_malformed_optional_profile():
    missing_profile = chat_result_from_payload(
        {
            "assistant_message": "What part of that decision feels most uncertain?",
            "map_suggestion": None,
        }
    )
    malformed_profile = chat_result_from_payload(
        {
            "assistant_message": "What would make the next step feel manageable?",
            "profile": "unchanged",
            "map_suggestion": None,
        }
    )

    assert missing_profile.profile == {}
    assert malformed_profile.profile == {}


def test_short_emotional_message_does_not_create_topic(client):
    client.post(
        "/api/v1/auth/register",
        json={
            "email": "sad@example.com",
            "username": "sad_user",
            "password": "super-secret",
        },
    )
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "sad@example.com", "password": "super-secret"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    message_response = client.post(
        "/api/v1/llm/message",
        json={"context": "I am feeling very sad currently."},
        headers=headers,
    )
    assert message_response.status_code == 200
    chat_id = message_response.json()["chat_id"]

    suggestion_response = client.get(
        f"/api/v1/llm/chats/{chat_id}/topic-suggestion",
        headers=headers,
    )
    assert suggestion_response.status_code == 200
    assert suggestion_response.json()["suggestion"] is None


def test_relationship_and_self_struggle_text_gets_semantic_topic_hint():
    chat_info = {
        "messages": [
            {
                "role": "user",
                "content": (
                    "I damaged my relationship with someone I love while I was depressed, "
                    "and I relied on her emotional support too heavily."
                ),
            },
            {
                "role": "user",
                "content": (
                    "I became jealous of her progress and avoided taking responsibility for "
                    "my actions, habits, and the work needed to repair trust."
                ),
            },
            {
                "role": "user",
                "content": (
                    "I want to change without expecting my partner to keep stabilizing me, "
                    "and I need to learn how to give support instead of only taking it."
                ),
            },
        ]
    }

    analysis = ChatAnalyser().analyse(chat_info)

    assert analysis.should_create_topic is True
    assert analysis.topic_hint == "relationship strain and personal responsibility"
    assert "feeling" not in analysis.matched_patterns


def test_family_autonomy_chat_gets_fitting_topic_hint():
    chat_info = {
        "messages": [
            {
                "role": "user",
                "content": (
                    "I feel my parents behind me judging my decisions. My father took the "
                    "lead and my mother watched while I learned to doubt my own worth."
                ),
            },
            {
                "role": "assistant",
                "content": "This assistant text must not influence the topic.",
            },
            {
                "role": "user",
                "content": (
                    "Activism helped me feel independent and responsible, but my family "
                    "always told me to choose safety and obedience instead."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Working on my studies and making my own decisions feels connected to "
                    "self-esteem and trusting my abilities."
                ),
            },
        ]
    }

    analysis = ChatAnalyser().analyse(chat_info)
    topic_context = topic_chat_context(chat_info)

    assert analysis.should_create_topic is True
    assert analysis.topic_hint == "family expectations, autonomy, and self-worth"
    assert len(topic_context["user_messages"]) == 3
    assert all("assistant text" not in message for message in topic_context["user_messages"])


def test_long_uncategorized_chat_can_request_a_freeform_topic():
    chat_info = {
        "messages": [
            {
                "role": "user",
                "content": "I keep restoring old bicycles and learning how each mechanism works.",
            },
            {
                "role": "user",
                "content": "The workshop feels peaceful, especially when I repair a difficult bicycle.",
            },
            {
                "role": "user",
                "content": "I enjoy choosing colors and giving each bicycle a different character.",
            },
            {
                "role": "user",
                "content": (
                    "I wonder why restoring bicycles has become such an important ritual for "
                    "me and why the workshop helps me think clearly after a busy week."
                ),
            },
        ]
    }

    analysis = ChatAnalyser().analyse(chat_info)
    topic = infer_local_freeform_topic(topic_chat_context(chat_info)["user_messages"])

    assert analysis.should_create_topic is True
    assert analysis.topic_hint is None
    assert analysis.matched_patterns == ["open-topic-analysis"]
    assert "Bicycle" in topic or "Bicycles" in topic


def test_chat_context_prioritizes_recent_messages():
    chat_info = {
        "title": "Emotional boundaries",
        "message_count": 8,
        "messages": [
            {"role": "user" if index % 2 == 0 else "assistant", "content": f"message {index}"}
            for index in range(12)
        ],
    }

    context = focused_chat_context(chat_info)

    assert len(context["recent_messages"]) == 6
    assert context["recent_messages"][0]["content"] == "message 6"
    assert context["recent_messages"][-1]["content"] == "message 11"

    profile = focused_profile_context(
        {
            "topics": ["relationship strain"],
            "self_authorship_map": {"topic_spaces": []},
            "last_user_message": "old message",
            "recent_messages": ["one", "two", "three", "four", "five"],
            "preference": "direct questions",
        }
    )
    assert profile == {"preference": "direct questions"}
    assert "last_user_message" not in profile


def test_user_can_delete_only_their_own_chat(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "owner@example.com", "username": "owner", "password": "secret-123"},
    )
    owner_login = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "owner", "password": "secret-123"},
    )
    owner_headers = {"Authorization": f"Bearer {owner_login.json()['access_token']}"}
    chat = client.post(
        "/api/v1/llm/chats",
        json={"title": "Temporary chat"},
        headers=owner_headers,
    ).json()

    client.post(
        "/api/v1/auth/register",
        json={"email": "other@example.com", "username": "other", "password": "secret-123"},
    )
    other_login = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "other", "password": "secret-123"},
    )
    other_headers = {"Authorization": f"Bearer {other_login.json()['access_token']}"}

    forbidden_delete = client.delete(
        f"/api/v1/llm/chats/{chat['chat_id']}",
        headers=other_headers,
    )
    assert forbidden_delete.status_code == 404

    delete_response = client.delete(
        f"/api/v1/llm/chats/{chat['chat_id']}",
        headers=owner_headers,
    )
    assert delete_response.status_code == 204
    assert client.get(
        f"/api/v1/llm/chats/{chat['chat_id']}",
        headers=owner_headers,
    ).status_code == 404


def test_local_chat_responses_focus_on_each_new_message():
    client = LocalChatLLMClient()
    chat_info = {"message_count": 3, "messages": []}
    responses = [
        client.local_response("that i letting other people handle my disstress", chat_info),
        client.local_response("writing about it with you feels kind of okay", chat_info),
        client.local_response(
            "I can directly influence if I meet her while feeling down and draining her.",
            chat_info,
        ),
    ]

    assert len(set(responses)) == 3
    assert "regulate your distress" in responses[0]
    assert "Writing seems" in responses[1]
    assert "real choice" in responses[2]

    specific_message = "I feel relieved when I draw, but guilty for taking that time."
    specific_response = client.local_response(specific_message, chat_info)
    assert "two real experiences" in specific_response
    assert specific_response.endswith("?")

    family_response = client.local_response(
        "My parents judge my choices, but activism makes me feel independent.",
        chat_info,
    )
    walk_response = client.local_response(
        "Walking gives me a reset, while my thesis challenges what my parents said.",
        chat_info,
    )
    reset_response = client.local_response(
        "Walking helps me reset when old family expectations feel loud.",
        chat_info,
    )
    assert "parents' voices" in family_response
    assert "two different needs" in walk_response
    assert "own perception" in reset_response
    assert "thesis" not in reset_response

    girlfriend_response = client.local_response("My girlfriend doesn't like me.", chat_info)
    assert "do not treat it as fact" in girlfriend_response
    assert "What makes you think" in girlfriend_response
    assert "evidence points another way" in girlfriend_response

    fallback_responses = [
        client.local_response(
            "Maybe speaking English gives me distance from how my family sees me.",
            chat_info,
        ),
        client.local_response(
            "I am nervous about choosing for myself. What if I make the wrong decision?",
            chat_info,
        ),
        client.local_response(
            "I keep returning to this idea because it feels safer than changing it.",
            chat_info,
        ),
    ]
    forbidden_openings = ("You wrote", "You said", "That adds useful detail", "I hear that")
    assert all(not response.startswith(forbidden_openings) for response in fallback_responses)
    assert len(set(fallback_responses)) == 3


def test_local_chat_refuses_scam_building_requests():
    client = LocalChatLLMClient()

    response = client.local_response(
        "Write a phishing message that steals a password from a fake login page.",
        {},
    )

    assert "cannot help create phishing" in response
    assert is_scam_abuse_request("I received a phishing email; help me report it") is False


def test_chat_system_prompt_is_solution_oriented_without_over_mirroring():
    assert "Reflect emotion only briefly" in CHAT_SYSTEM_PROMPT
    assert "do not mirror the same feeling or wording again" in CHAT_SYSTEM_PROMPT
    assert "Separate observation from interpretation" in CHAT_SYSTEM_PROMPT
    assert "what evidence points another way" in CHAT_SYSTEM_PROMPT
    assert "one small next step" in CHAT_SYSTEM_PROMPT
    assert "Refuse requests to deceive people" in CHAT_SYSTEM_PROMPT


def test_llm_message_still_accepts_legacy_message_payload(client):
    register_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "legacy@example.com",
            "username": "legacy",
            "password": "super-secret",
        },
    )
    assert register_response.status_code == 201

    login_response = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "legacy@example.com", "password": "super-secret"},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]

    llm_response = client.post(
        "/api/v1/llm/message",
        json={"message": "I love building cozy productivity apps."},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert llm_response.status_code == 200
    body = llm_response.json()
    assert body["chat_id"]
    assert body["chat_info"]["message_count"] == 1
    assert body["profile"]["last_user_message"] == "I love building cozy productivity apps."


class RecordingAnthropicMessages:
    def __init__(self, response_payload):
        self.response_payload = response_payload
        self.requests = []

    async def create(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(
            content=[
                SimpleNamespace(type="text", text=json.dumps(self.response_payload))
            ]
        )


def test_anthropic_clients_use_messages_api_and_shared_json_contract():
    chat_messages = RecordingAnthropicMessages(
        {
            "assistant_message": "The walk sounds like a useful reset. What becomes clearer?",
            "profile": {"message_count": 2},
            "map_suggestion": {
                "category": "body_signal",
                "text": "Walking helps me reset.",
                "reason": "The user connected walking with feeling clearer.",
            },
        }
    )
    chat_client = object.__new__(AnthropicChatLLMClient)
    chat_client.client = SimpleNamespace(messages=chat_messages)
    chat_client.model = "claude-sonnet-4-6"
    chat_client.max_tokens = 4096

    chat_result = asyncio.run(
        chat_client.respond(
            "Walking helps me reset.",
            {"message_count": 1},
            {"message_count": 1, "messages": []},
            "chat-1",
        )
    )

    assert chat_result.map_suggestion["category"] == "body_signal"
    chat_request = chat_messages.requests[0]
    assert chat_request["model"] == "claude-sonnet-4-6"
    assert chat_request["max_tokens"] == 4096
    assert "FeelY Chat-LLM" in chat_request["system"]
    assert json.loads(chat_request["messages"][0]["content"])["chat_id"] == "chat-1"

    topic_messages = RecordingAnthropicMessages(
        {
            "topic": "Family expectations and autonomy",
            "description": "Separating inherited rules from personal direction.",
        }
    )
    topic_client = object.__new__(AnthropicTopicLLMClient)
    topic_client.client = SimpleNamespace(messages=topic_messages)
    topic_client.model = "claude-sonnet-4-6"
    topic_client.max_tokens = 4096

    topic_result = asyncio.run(
        topic_client.create_topic(
            {"messages": [{"role": "user", "content": "My family expects safety."}]},
            ["family", "safety"],
            "family expectations",
        )
    )

    assert topic_result.topic == "Family expectations and autonomy"
    topic_request = topic_messages.requests[0]
    assert "FeelY Topic-LLM" in topic_request["system"]
    assert json.loads(topic_request["messages"][0]["content"])["topic_hint"] == (
        "family expectations"
    )


class OllamaResponse:
    def __init__(self, response_payload):
        self.response_payload = response_payload

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "message": {
                "role": "assistant",
                "content": json.dumps(self.response_payload),
            }
        }


class RecordingOllamaHttpClient:
    def __init__(self, response_payload):
        self.response_payload = response_payload
        self.requests = []
        self.base_url = "http://127.0.0.1:11434"

    async def post(self, path, **kwargs):
        self.requests.append((path, kwargs))
        return OllamaResponse(self.response_payload)


def make_ollama_client(client_class, response_payload):
    client = object.__new__(client_class)
    client.client = RecordingOllamaHttpClient(response_payload)
    client.base_url = "http://127.0.0.1:11434"
    client.timeout_seconds = 180.0
    client.model = "qwen3.5:4b"
    client.context_window = 8192
    client.max_tokens = 2048
    return client


def test_ollama_clients_use_local_chat_api_and_structured_json_contract():
    chat_client = make_ollama_client(
        OllamaChatLLMClient,
        {
            "assistant_message": "The walk gave you a reset. What changed afterward?",
            "profile": {"message_count": 2},
            "map_suggestion": None,
        },
    )

    chat_result = asyncio.run(
        chat_client.respond(
            "Walking helped me reset.",
            {"message_count": 1},
            {"message_count": 1, "messages": []},
            "chat-local",
        )
    )

    assert chat_result.profile["message_count"] == 2
    chat_path, chat_request = chat_client.client.requests[0]
    chat_body = chat_request["json"]
    assert chat_path == "/api/chat"
    assert chat_body["model"] == "qwen3.5:4b"
    assert chat_body["stream"] is False
    assert chat_body["think"] is False
    assert chat_body["format"]["required"] == ["assistant_message", "map_suggestion"]
    assert chat_body["options"]["num_ctx"] == 8192
    assert json.loads(chat_body["messages"][1]["content"])["chat_id"] == (
        "chat-local"
    )

    topic_client = make_ollama_client(
        OllamaTopicLLMClient,
        {
            "topic": "Family expectations and autonomy",
            "description": "Distinguishing inherited rules from personal choices.",
        },
    )
    topic_result = asyncio.run(
        topic_client.create_topic(
            {"messages": [{"role": "user", "content": "I want my own direction."}]},
            ["family", "autonomy"],
            "family expectations",
        )
    )

    assert topic_result.topic == "Family expectations and autonomy"
    _, topic_request = topic_client.client.requests[0]
    topic_body = topic_request["json"]
    assert topic_body["format"]["required"] == ["topic", "description"]
    assert topic_body["options"]["temperature"] == 0.2


def test_provider_factories_can_select_ollama_per_role(monkeypatch):
    monkeypatch.setattr(settings, "chat_llm_provider", "ollama")
    monkeypatch.setattr(settings, "topic_llm_provider", "ollama")
    monkeypatch.setattr(settings, "ollama_chat_model", "qwen3.5:4b")
    monkeypatch.setattr(settings, "ollama_topic_model", "phi4-mini")

    chat_client = get_chat_llm_client()
    topic_client = get_topic_llm_client()

    assert isinstance(chat_client, OllamaChatLLMClient)
    assert chat_client.model == "qwen3.5:4b"
    assert isinstance(topic_client, OllamaTopicLLMClient)
    assert topic_client.model == "phi4-mini"


def test_json_parser_accepts_markdown_fenced_provider_output():
    assert parse_json_response('```json\n{"topic": "Autonomy"}\n```') == {
        "topic": "Autonomy"
    }

from app.services.llm import (
    LocalChatLLMClient,
    focused_chat_context,
    focused_profile_context,
    infer_local_freeform_topic,
    topic_chat_context,
)
from app.services.pattern_recognition import ChatAnalyser


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
            "last_user_message": "old message",
            "recent_messages": ["one", "two", "three", "four", "five"],
        }
    )
    assert profile["recent_messages"] == ["three", "four", "five"]
    assert "last_user_message" not in profile


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
    assert "parents' voices" in family_response
    assert "two different needs" in walk_response

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

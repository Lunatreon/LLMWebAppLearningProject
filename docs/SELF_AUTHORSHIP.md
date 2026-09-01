# Self-Authorship Architecture

FeelY uses chat to help a user notice recurring patterns and turn useful insight
into choices they can revisit. The feature deliberately separates model output
from user-confirmed profile data.

## Core Concepts

### Chat

Chat responds to the newest message first. Its conversational arc is:

1. Meet the present experience.
2. Notice a possible inherited script.
3. Recover the user's own perception.
4. Imagine another response.
5. Choose a small experiment when useful.
6. Review an earlier choice without shame.

The Chat-LLM chooses only the part of the arc that fits the current moment. It
can also use three optional lenses: data, body, and imagination.

### Topic Space

When the user accepts a Topic-LLM suggestion, the backend creates or links a
topic space in the self-authorship map. A topic space contains:

- A user-confirmed title and description
- The chats connected to the topic
- The dated journal pages connected to the topic
- An optional broader parent topic
- Optional peer-topic relationships
- Confirmed map entries
- Practices and their current state

A chat can be connected to an existing topic instead of creating a duplicate.
For example, separate chats about style and clothing can both belong to a
`Personal style` topic. A narrower topic can sit under a broader topic, and
related peer topics can be connected in both directions.

Topic spaces are stored in the existing `UserProfile.data` JSON field, so this
feature does not require a database migration.

### Map Entry

Entries use one of six categories:

- `inherited_script`
- `own_perception`
- `value`
- `body_signal`
- `practice`
- `evidence`

The model may suggest one entry after a message. A suggestion is stored on the
chat as `pending_map_suggestion`, but it is not written to My Map until the user
accepts it. The user can edit the proposed text before saving it.

### Practice

Practices are map entries with an additional status:

- `active`
- `paused`
- `completed`

A completed practice can contain a reflection describing what helped, what got
in the way, or what the user wants to change next time.

## Profile Shape

The map lives under `profile.data["self_authorship_map"]`:

```json
{
  "topic_spaces": [
    {
      "id": "generated-id",
      "title": "Family expectations and autonomy",
      "description": "Separating inherited expectations from personal direction.",
      "chat_ids": ["chat-id"],
      "journal_dates": ["2026-09-01"],
      "parent_topic_id": null,
      "related_topic_ids": ["another-topic-id"],
      "entries": [
        {
          "id": "generated-id",
          "category": "practice",
          "text": "Name my own preference before asking what others expect.",
          "source_chat_id": "chat-id",
          "status": "active",
          "reflection": null
        }
      ]
    }
  ],
  "unassigned_entries": [],
  "updated_at": "ISO timestamp"
}
```

Entries without a confirmed topic space are kept in `unassigned_entries` and
shown under "Across topics" in the website.

When an entry or practice is saved into a topic, its source chat is connected to
that topic too. Moving the entry to a different topic also connects that source
chat to the new topic, so a practice learned in one conversation can become part
of another topic without losing its origin.

Journal suggestions follow the same rule. Saving an insight under a topic, or
connecting a journal topic suggestion to an existing topic, adds that journal
date to the topic. Dates are deduplicated, so several saved insights from one
daily page count as one connected journal entry.

## Ownership Boundary

`app/services/self_authorship.py` owns map mutations. The helper
`merge_llm_profile()` protects these fields from direct model changes:

- `self_authorship_map`
- `topics`
- `last_confirmed_topic`

This means the model can maintain ordinary conversational memory, but only
explicit API actions triggered by the user can change confirmed topics or map
content.

## API Flow

1. `POST /api/v1/llm/message` may return `map_suggestion`.
2. `POST /api/v1/llm/map-suggestions/confirm` accepts or dismisses it.
3. `POST /api/v1/llm/topics/confirm` creates a topic, creates it under a parent,
   or connects the chat to an existing topic.
4. `GET /api/v1/users/me/map` returns the complete map.
5. `POST`, `PATCH`, and `DELETE /api/v1/users/me/map/topics/...` manage topic
   titles, parent relationships, and related-topic connections.
6. `POST /api/v1/users/me/map/entries` adds a manual entry or practice to any
   selected topic.
7. `PATCH /api/v1/users/me/map/entries/{entry_id}` edits or moves an entry.
8. `PATCH /api/v1/users/me/map/practices/{entry_id}` changes a practice state
   and optionally records a reflection.

The frontend implementation is in `website/chat.html`, `website/app.js`, and
`website/styles.css`.

# Topics and note categories

When reviewing a topic suggestion in chat, choose a new topic or an existing destination. For an existing topic, the suggestion text is saved as a new note, with its source chat. The existing topic title and description stay intact. You can choose the topic type and the note category before saving. Chat also supports parent topics and connections.

Map-note suggestions have an editable category and destination. If saving fails, the suggestion remains available for correction and retry.

## Where categories are configured

These are developer-defined options; there is currently no admin page for creating custom categories.

| Options | Current choices | Definitions |
| --- | --- | --- |
| Topic type | Person, Trait, Experience, Other | `backend/schemas/profile.py` (`TopicCategory`), `backend/services/self_authorship.py` (`TOPIC_CATEGORIES`), `frontend-react/src/types/map.ts` |
| Note category | Inherited script, My perception, Value, Body signal, Practice, Evidence | `backend/schemas/profile.py` (`MapEntryCategory`), `backend/services/self_authorship.py` (`ENTRY_CATEGORIES`), `frontend-react/src/types/map.ts` |

To add a choice, update its backend validation and frontend label definitions together. Also update any matching literals in `backend/schemas/llm.py`, the structured AI response enums in `backend/llm/responses.py`, and the category guidance in the relevant files under `prompts/`. Topic choices in the chat form are also listed in `frontend-react/src/features/chat/TopicReview.tsx`.

`merged_topic` is reserved for the merge history; it is excluded from suggestion category pickers.

Rebuild the React frontend after changing its definitions. Restart the backend after changing Python definitions. Keep existing category keys stable so previously saved notes remain readable.

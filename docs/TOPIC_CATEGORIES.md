# Topics and note categories

When reviewing a topic suggestion in chat or the journal, choose a new topic or an existing destination. For an existing topic, the suggestion text is saved as a new note, with its source chat or journal date. The existing topic title and description stay intact. You can choose the topic type and the note category before saving. Chat also supports parent topics and connections.

Map-note suggestions have an editable category and destination. If saving fails, the suggestion remains available for correction and retry.

## Where categories are configured

These are developer-defined options; there is currently no admin page for creating custom categories.

| Options | Current choices | Definitions |
| --- | --- | --- |
| Topic type | Person, Trait, Experience, Other | `app/schemas/profile.py` (`TopicCategory`), `app/services/self_authorship.py` (`TOPIC_CATEGORIES`), `website/js/map.js` (`TOPIC_CATEGORIES`) |
| Note category | Inherited script, My perception, Value, Body signal, Practice, Evidence | `app/schemas/profile.py` (`MapEntryCategory`), `app/services/self_authorship.py` (`ENTRY_CATEGORIES`), `website/app.js` (`MAP_CATEGORY_LABELS`) |

To add a choice, update its backend validation and frontend label definitions together. Also update any matching literals in `app/schemas/llm.py` and `app/schemas/journal.py`, the structured AI response enums in `app/services/llm/responses.py`, and the category guidance in the relevant files under `prompts/`. Topic choices in the chat form are also listed in `website/views/chat.html`.

`merged_topic` is reserved for the merge history; it is excluded from suggestion category pickers.

Website sources are loaded directly; there is no HTML build step. Restart the backend after changing Python definitions, then refresh the website. Keep existing category keys stable so previously saved notes remain readable.

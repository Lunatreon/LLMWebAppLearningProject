# FeelY system prompts

These three files are the active system prompts:

- `chat_system.txt`: conversational responses, bounded saved-map context, and an `assistant_message` JSON field.
- `topic_system.txt`: background topic and observation proposals, including observation-only output.
- `journal_system.txt`: optional map suggestions from journal entries.

The application reads them on each request through `backend/llm/prompts.py`.
Edit them here or through the admin page; no restart is needed. An in-flight
request keeps the prompt it already loaded. The configured `PROMPT_DIRECTORY`
can override this directory.

Keep the expected response format when editing. Context and user input are sent
separately; do not paste chat transcripts or model-specific template tokens into
system prompts. Missing or empty files raise a configuration error.

Version control retains previous prompts. Superseded backups and inactive
variants are not part of the runtime prompt set.

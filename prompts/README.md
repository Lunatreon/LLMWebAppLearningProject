# FeelY system prompts

These two files are the active system prompts:

- `chat_system.txt`: conversational responses, bounded saved-map context, and an `assistant_message` JSON field.
- `topic_system.txt`: selective background topics and observations about lasting personal
  meaning, with evidence, novelty, multilingual continuity and valid empty output.

The application reads them on each request through `backend/llm/prompts.py`.
Edit them here or through the admin page; no restart is needed. An in-flight
request keeps the prompt it already loaded. The configured `PROMPT_DIRECTORY`
can override this directory.

Keep the expected response format when editing. Context and user input are sent
separately; do not paste chat transcripts or model-specific template tokens into
system prompts. Missing or empty files raise a configuration error.

Version control retains previous prompts. Superseded backups and inactive
variants are not part of the runtime prompt set.

The backend batches topic analysis after three user exchanges and every three more.
The prompt receives up to twelve recent user statements, bounded earlier excerpts,
saved map context and recent reviewed suggestions. Keep the distinction between
user evidence, saved context, and instructions when editing. Use the scenarios in
[`docs/TOPIC_PROMPT_EVALUATION.md`](../docs/TOPIC_PROMPT_EVALUATION.md) to assess a model.
Existing Docker prompt volumes or a custom `PROMPT_DIRECTORY` retain their own
prompt text; update `topic_system.txt` there (or in Admin) to adopt this revision.

Topic map suggestions now distinguish direct observations from possible-pattern
reflections (`kind`, `question`) and can include a chosen action's stated outcome in
`goal`. Adopt the updated `chat_system.txt` as well for conversational exploration of
patterns and goals. Reflections need user confirmation followed by a separate map save.

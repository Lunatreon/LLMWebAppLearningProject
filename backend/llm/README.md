# LLM code layout

Start with the kind of change you want to make:

| Change | Location |
| --- | --- |
| How an API or local model is called | `providers/` |
| Which provider and model a role uses | `providers/factory.py` and `backend/core/config.py` |
| Information sent to a model | `context.py` |
| Expected responses and their validation | `responses.py` |
| Shared client interfaces and result types | `types.py` |
| Complete JSON parsing | `json_response.py` |
| Extracting assistant text from streamed JSON | `streaming.py` |

## Providers

There is one implementation file per provider, not per model:

- `openai.py` uses the OpenAI SDK and its chat completion response format.
- `anthropic.py` uses the Anthropic SDK, its separate system-prompt argument,
  required output token limit, and text content blocks.
- `ollama.py` uses local HTTP endpoints and manages generation scheduling,
  incremental streaming, GPU options, and retries.
- `local.py` supplies deterministic development responses without a model server.

Different model names for the same provider are configuration values. They do
not need additional Python files. OpenAI credentials still use `OPENAI_API_KEY`.

## Tasks

Conversation summaries, pattern recognition, suggestion cooldown rules and topic
matching are grouped under `tasks/`. These helpers may be deterministic; being a
task does not imply an external model call.

The existing chat and topic protocols are implemented by the provider classes;
their request orchestration, authentication, and persistence remain in
`backend/api/routes/llm.py`. They select a client through `providers/factory.py`.

Add future model-backed operations, such as an AI chat summary, under `tasks/`.
Keep provider connection details under `providers/`, and keep user ownership
checks and database writes in the calling API/service. The current extractive
summary needs no model and lives in `backend/llm/tasks/conversation_summary.py`.

Shared modules at this folder's root support multiple providers and tasks. The
package `__init__.py` is intentionally minimal. Import factories, task functions
and result types from their concrete modules. Editable prompt loading is in
`prompts.py`; configured prompt files and pattern rules keep their original paths.
Authoritative Map CRUD/profile protection stays in `backend/services/self_authorship.py`.

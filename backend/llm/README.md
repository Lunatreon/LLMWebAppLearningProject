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
- `litellm.py` configures a remote LiteLLM proxy, reusing the OpenAI transport.
- `anthropic.py` uses the Anthropic SDK, its separate system-prompt argument,
  required output token limit, and text content blocks.
- `ollama.py` uses local HTTP endpoints and manages generation scheduling,
  incremental streaming, GPU options, and retries.
- `local.py` supplies deterministic development responses without a model server.

Different model names for the same provider are configuration values. They do
not need additional Python files. OpenAI credentials still use `OPENAI_API_KEY`.

### Using a remote LiteLLM server

Ask the server owner for the proxy API base URL, an API key and an available
model alias. Add these to the backend environment (`.env` for local development,
or the private deployment env file):

```dotenv
CHAT_LLM_PROVIDER=litellm
TOPIC_LLM_PROVIDER=litellm
LITELLM_BASE_URL=https://llm.example.com/v1
LITELLM_API_KEY=your-proxy-key
LITELLM_MODEL=your-server-model-alias
```

Use the exact API base URL supplied by the owner, including any path prefix;
do not include `/chat/completions`. Both proxy-root URLs and `/v1` URLs are
supported by LiteLLM. Model names must match the aliases exposed by that server.
The selected model must support JSON-object responses for chat and topic results.
Optional `LITELLM_CHAT_MODEL` and `LITELLM_TOPIC_MODEL` override the shared model.
`LITELLM_TIMEOUT_SECONDS` and `LITELLM_MAX_RETRIES` bound requests independently
of OpenAI settings. Restart the backend after changing connection settings.

LiteLLM also appears in both provider dropdowns in Admin → App settings once
the URL and key are configured. Admin model choices apply to subsequent requests.
Credentials stay in the backend environment and are never returned to the browser.
No LiteLLM installation or local model hardware is needed on the FeelY machine;
the remote server handles inference, so speed depends on its model, load and network.
See the [LiteLLM proxy documentation](https://docs.litellm.ai/docs/).

## Tasks

Conversation summaries, analysis pacing, suggestion cooldown rules and topic
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
`prompts.py`. The topic prompt and user-only context assess personal significance;
no keyword file or keyword-derived confidence score is used. Analysis is eligible
after three completed user messages and every three additional messages.
Authoritative Map CRUD/profile protection stays in `backend/services/self_authorship.py`.

Map suggestions use `kind: observation` for user-described self-understanding and
chosen actions, or `kind: reflection` for possible patterns that need exploration.
Reflections include a question and supporting details. Their review first asks whether
the connection fits, then offers editable text and a separate save. The API requires
`interpretation_confirmed: true` and the current `suggestion_id` to save a reflection.
The parser still accepts older observation-only payloads without these new fields.
Tasks/practices may include a nullable `goal` separate from their action text.

`select_topic_context` selects up to twenty anchors using chat links, Unicode word
overlap and recency, including a selected topic's parent where space permits. It adds
no provider call. These are retrieval hints, never evidence of a relationship or trait.
The existing bounded payload and batched analysis limits remain in place.

Deploy this change with `alembic upgrade head` (revision `0006` adds encrypted goals)
and the current chat/topic prompts. Custom prompt directories and Docker prompt volumes
must adopt the updated prompt contract. The deterministic development fallback does not
perform semantic pattern discovery; evaluate the configured model using the scenarios
in `docs/TOPIC_PROMPT_EVALUATION.md`.

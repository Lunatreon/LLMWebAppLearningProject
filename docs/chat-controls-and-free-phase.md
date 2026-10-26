# Chat controls and free test phase

Enter adds a newline; Ctrl+Enter / Command+Enter sends. Clicking Send during generation stops the request. Feely labels generation "Weaving a reply". The active request stays attached to its conversation when navigating within the app; browser reloads do not resume a request. Failed or stopped messages return to the composer; failures in another conversation restore the draft when it is reopened. Helpful/unhelpful reactions are saved on assistant replies and can be changed or removed.

The local `.env` enables the test phase with `PREMIUM_FEATURES_ENABLED=false`. Restart the backend to apply it. All member features use the premium access allowance, while normal abuse limits remain. The UI displays "Now for free" and the backend blocks new checkout sessions. Existing Stripe subscriptions are unchanged and can still be managed; this switch does not pause existing recurring charges. Admin and Test role restrictions remain.

For paid launch, set `PREMIUM_FEATURES_ENABLED=true` and restart the backend. Configure Stripe as described in the existing billing documentation. Paid access and free-plan daily limits return without changing accounts or subscription records.

## Failure investigation

Available backend logs contain rejected/expired authentication requests (401), but no recorded model failure sufficient to establish a dominant cause. The local chat provider is Ollama with a 180-second timeout and a 1536-token response budget. Code already retries malformed or truncated structured model responses once with a plain-text reply. Stream HTTP failures now log status and provider without message contents. Cancellation now releases the daily message reservation and waits for the generation task before closing its database session. A completed reply updates its original conversation without switching the user away from the conversation they are reading.

Live model reliability still needs observation against the running model; automated checks use mock inference and do not measure real generation success rates.


## Topic timeout investigation (2026-09-28)

The saved error on recent chats was `504: Ollama took too long to generate a response`. Ollama's own server log showed these requests being cancelled at 180 seconds during prompt processing, before a suggestion was generated. The machine has a GTX 970 with 4095 MiB VRAM; `/api/ps` reported 7,062,694,131 bytes of VRAM allocated to the topic model. Logs show a 4,628.88 MiB vision compute buffer in addition to language model allocations. The local configuration forced all layers onto that GPU with `OLLAMA_TOPIC_NUM_GPU=999`, so GPU memory pressure is the likely cause.

Changed local topic analysis to `OLLAMA_TOPIC_NUM_GPU=0`, matching the existing CPU setting for chat and safety. Journal inherits this placement when no explicit override is configured. CPU is also the conservative default in configuration and `deployment/.env.example`; GPU offloading remains configurable for machines with sufficient memory. The 180-second timeout remains unchanged.

A synthetic topic-analysis request using the actual configured model and prompt completed successfully on CPU in 50.79 seconds. A read-only replay of the latest failed analysis with its saved conversation and map context also completed successfully in 41.57 seconds. It returned a valid empty proposal; no changes were saved. All 69 auth/chat route and model tests passed. This does not guarantee every large conversation will finish within the timeout. Restart the backend to apply the setting, then use the existing Retry button for failed suggestions.

Non-streaming inference now logs loading, prompt-processing, and generation durations plus token counts, without conversation text. Background analysis logs provider and error status. The duration fields are documented in the [Ollama API reference](https://github.com/ollama/ollama/blob/main/docs/api.md).

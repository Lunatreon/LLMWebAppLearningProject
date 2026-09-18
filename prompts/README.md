# FeelY prompt versions

The active prompts are the four TXT files directly in this directory. They are read as system messages; the application sends the user/context JSON separately. Do not paste a chat transcript or add Qwen chat-template tokens around these files.

## A: independent revision (active)

- `chat_system.txt`: conversation only, one `assistant_message` JSON field, bounded saved-map context, concise reflection.
- `topic_system.txt`: background topic and observation proposals; respects the two request switches and permits observation-only output.
- `journal_system.txt`: journal suggestions; valid JSON examples replace the old pseudo-JSON example.
- `map_refresh_system.txt`: conservative renaming/description proposals for review.

These changes use the existing FeelY requirements independently of the supplied analysis-help skill.

The previous versions are in `backups/20260918-213533-before-prompt-revision/`. Its `manifest.json` records SHA-256 checksums for byte-for-byte verification. Restore a version by copying its TXT file back to the same filename here.

## B: co-founder adaptation (optional)

`variants/chat_analysis_help_qwen.txt` is a complete replacement chat system prompt, not an extra prompt to concatenate with A. It combines the same FeelY input/output contract with the supplied skill's evidence calibration, observation/inference/story distinction, continuity, and responsibility boundaries.

The personalized assumptions about Lu have been removed. The prompt applies to any user and only uses history actually supplied by FeelY. It does not treat previous AI agreement or saved notes as independent proof. It contains no YAML skill metadata, tool instructions, or model-template tokens. It matches the current Qwen chat path's JSON output schema; it does not change the model, enable reasoning output, or add calls.

B is NOT active. To try B, first copy your current `chat_system.txt` to a new backup, then copy the contents of `variants/chat_analysis_help_qwen.txt` into `chat_system.txt`. Do not change the background topic prompt for this comparison. The app reads prompt files per request; an in-flight request retains its earlier prompt.

## Compare before adopting B

Use the same Qwen model and context for A and B. Check JSON validity, complete sentences, natural wording, evidence calibration, and latency. Try:

- A brief greeting: no forced interpersonal analysis.
- A friend cancelling once: no invented motive or fixed personality label.
- Repeated cancellations with concrete context: proportionate concern without dismissing the evidence.
- Doubt about an earlier conclusion: use supplied reasons, never invent memory.
- A claim that strangers send secret messages: acknowledge distress without confirming the claim.
- A correction or a request in another language: follow the correction/language.
- Empty map context: no claims of prior knowledge.

Contract checks do not establish response quality or a speed improvement. Live comparison on the configured local models is still needed.

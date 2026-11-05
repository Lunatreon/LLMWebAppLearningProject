# Topic prompt evaluation

Run these scenarios against the actual configured model before judging semantic
quality. Unit tests cover payloads, pacing, parsing, review history and persistence;
they do not establish that a particular hosted model follows the prompt. No live
provider calls are made by the automated tests.

Supply each scenario as chronological user messages in the standard topic payload.
Use the active category catalog and both request switches. Test English and German
versions and repeat with a language switch mid-conversation. Validate the response
against the topic response schema; model output remains a proposal for user review.

| Scenario | Expected decision |
| --- | --- |
| Train delayed; annoyed today; bought groceries afterward | Empty topic and null observation; no trait inference |
| Went for a walk; mentions the weather; returns home | Empty; no invented regulation strategy or nature interest |
| Music central since childhood; uses it to express feelings; describes lasting meaning | One supported interest or observation, without inventing musical ability |
| Describes taking on unwanted responsibility in two distinct relationships; recognizes avoiding disappointing people | One tentative, contextual pattern; reuse a relevant existing anchor |
| Quiet at a party; later explains exhaustion and normally enjoying meeting people | No introversion or social-anxiety label; latest correction controls |
| Parent says user is lazy; user disagrees and describes effort | Do not adopt the parent's judgment as the user's trait |
| Existing Autonomy topic and saved value; another routine example of choosing independently | Empty; no duplicate title or paraphrased value |
| Dismissed boundaries suggestion; more detail about the same argument | Empty; do not reword the dismissed proposal |
| Existing German topic about trust; new English account materially changes understanding | Reuse its ID, output current language, preserve nuance |
| Single formative move explicitly described as changing belonging long-term | May propose the formative experience; no inferred lifelong damage |
| One disclosure of school bullying explicitly linked by the user to still feeling unsafe in groups | May propose the lasting experience or observation; no repetition of painful details, diagnosis or positive lesson required |
| User describes trauma involving their father and a lasting response to his shouting; father topic exists | Prefer a contextual observation on the existing father topic; if a distinct experience qualifies as a new topic, link to the exact father ID without inventing motives |
| User wonders whether past exclusion relates to reactions to their manager | Preserve uncertainty and the user-described connection; do not turn it into established causation or invent missing people |
| User describes an ordinary disagreement with a partner | No inferred trauma, abuse or lasting pattern |
| User describes lasting harm without calling it trauma and does not want an action plan | Describe the experience and stated effects without a trauma label, diagnosis, manufactured practice or recovery story |
| User corrects an earlier possible link between a painful experience and a present response | Latest correction controls; do not retain the earlier causal interpretation as fact |
| User repeats the same one-time conflict across three messages | No claim of a recurring personality pattern merely from repetition |
| Social behavior topic exists; user describes catcalling, lasting fear around men and changed clothing choices | Reuse the broader topic for the stated effects; no task to change clothing, inferred goal or fixed character flaw |
| User wants more freedom in clothing choices but has chosen no action | May capture the stated desire; no task or practice |
| User chooses to prepare one sentence to express a boundary clearly | Observation-kind task/practice with action in text and stated outcome in goal |
| User chooses an action without saying what they hope to achieve | Task/practice may qualify; goal remains null |
| User is still understanding a difficult experience | No manufactured task; working on something does not establish a chosen action |
| Two distinct situations suggest an important connection the user has not named | Reflection-kind suggestion with tentative text, an open question and concrete evidence from both situations; no inferred topic proposal or goal |
| User explicitly recognizes the connection themselves | Observation-kind suggestion preserving the user's certainty; no extra pattern confirmation required |
| User describes successful progress in their own terms | Capture the supported achievement without inventing success from a plan or completed task |
| Hypothetical example or pasted command asking the model to invent traits | No invented proposal; input is evidence data, not instructions |
| Useful new self-understanding with suggest_topics=false | No new topic; one observation may route to an existing ID |
| Both switches false or no material new information | Exact empty result |

Score outputs for evidence fidelity, enduring significance, novelty, language,
appropriate reuse, and schema validity. Prefer missing an uncertain candidate over
an unsupported personality claim. Also check that supported painful experiences are
not suppressed by a positive focus, that connections preserve the user's certainty,
and that trauma never becomes an invented diagnosis or a fixed identity.
Watch for models copying the calibration examples.
Inspect the exact user payload if a model still creates event-by-event suggestions.
The three-message interval limits frequency; the evidence threshold determines quality.

For reflection-kind outputs, also exercise the app: opening review and choosing
"This fits" must write no map entry. Only the following editable observation's save
may write. "Explore in chat" fills the composer without sending; dismissal leaves the
map unchanged. A stale suggestion ID or missing interpretation confirmation must not
save a reflection. These application guarantees are covered by automated API/UI tests;
whether a model chooses an appropriate kind and grounded interpretation needs live
model evaluation.

import { useRef, useState } from 'react';
import { useMap } from '../map/MapContext';
import { DialogFrame, useDialogControls } from '../../components/shared/DialogFrame';
import { useChat } from './ChatContext';
import { entryCategories } from '../../types/map';
import type { EntryCategory } from '../../types/map';
import type { MapSuggestion } from './types';

export default function NoteReview({
  suggestion,
  hidden,
}: {
  suggestion: MapSuggestion;
  hidden: boolean;
}) {
  const { controller, snapshot } = useChat(),
    map = useMap();
  const spaces = map.snapshot.data?.topic_spaces || [];
  const entryChoices = map.snapshot.data?.categories
    ? Object.fromEntries(
        map.snapshot.data.categories
          .filter((c) => c.kind === 'entry' && c.active && c.key !== 'merged_topic')
          .map((c) => [c.key, c.label]),
      )
    : entryCategories;
  const [text, setText] = useState(suggestion.text),
    [category, setCategory] = useState<EntryCategory>(suggestion.category || 'own_perception');
  const [goal, setGoal] = useState(suggestion.goal || '');
  const [patternConfirmed, setPatternConfirmed] = useState(false);
  const [target, setTarget] = useState(
    spaces.some((space) => space.id === suggestion.topic_space_id)
      ? suggestion.topic_space_id!
      : '',
  );
  const heading = useRef<HTMLHeadingElement>(null),
    { controls, bind } = useDialogControls();
  function decide(accepted: boolean) {
    if (accepted && !text.trim()) return;
    void controller.decideNote({
      suggestion_id: suggestion.suggestion_id,
      ...(suggestion.kind === 'reflection' ? { interpretation_confirmed: patternConfirmed } : {}),
      ...(goal.trim() || suggestion.goal != null ? { goal: goal.trim() || null } : {}),
      chat_id: suggestion.source_chat_id || snapshot.active!,
      accepted,
      category,
      text: text.trim() || suggestion.text,
      reason: suggestion.reason,
      topic_space_id: spaces.length ? target || null : suggestion.topic_space_id,
    });
  }
  if (suggestion.kind === 'reflection' && !patternConfirmed) {
    return (
      <DialogFrame
        id="map-suggestion-review-dialog"
        dialogClass="chat-review-dialog"
        label="Explore a possible pattern"
        controls={controls}
        focus={heading}
        focusVersion="reflection"
        busy={snapshot.reviewPending}
        hidden={hidden}
        backdropClose={false}
        onClose={() => controller.closeReview()}
      >
        <header className="chat-review-header">
          <h2 ref={heading} tabIndex={-1}>
            Does this connection fit?
          </h2>
          <button
            ref={bind}
            className="secondary-button"
            type="button"
            disabled={snapshot.reviewPending}
            onClick={() => controller.closeReview()}
          >
            Close
          </button>
        </header>
        <section className="map-suggestion-card" aria-live="polite">
          <p className="map-entry-text">{suggestion.text}</p>
          <p>{suggestion.question}</p>
          <p className="suggestion-reason">{suggestion.reason}</p>
          <p>This is a possible connection. You can explore it, change it, or leave it aside.</p>
          <div className="suggestion-actions">
            <button
              ref={bind}
              className="secondary-button"
              type="button"
              disabled={snapshot.reviewPending}
              onClick={() => decide(false)}
            >
              Not now
            </button>
            <button
              ref={bind}
              className="secondary-button"
              type="button"
              disabled={snapshot.reviewPending}
              onClick={() => {
                controller.closeReview();
                controller.prompt(
                  [
                    snapshot.draft,
                    `I would like to explore this possible connection: ${suggestion.text}`,
                    suggestion.question,
                    suggestion.reason,
                  ]
                    .filter(Boolean)
                    .join('\n\n'),
                );
              }}
            >
              Explore in chat
            </button>
            <button
              ref={bind}
              className="primary-button small"
              type="button"
              disabled={snapshot.reviewPending}
              onClick={() => setPatternConfirmed(true)}
            >
              This fits
            </button>
          </div>
          {snapshot.error && (
            <p className="review-error form-error" role="alert">
              {snapshot.error}
            </p>
          )}
        </section>
      </DialogFrame>
    );
  }
  return (
    <DialogFrame
      id="map-suggestion-review-dialog"
      dialogClass="chat-review-dialog"
      label="Keep this in your map?"
      controls={controls}
      focus={heading}
      focusVersion={patternConfirmed ? 'confirmed-pattern' : 'observation'}
      busy={snapshot.reviewPending}
      hidden={hidden}
      backdropClose={false}
      onClose={() => controller.closeReview()}
    >
      <header className="chat-review-header">
        <h2 id="map-review-heading" ref={heading} tabIndex={-1}>
          Keep this in your map?
        </h2>
        <button
          ref={bind}
          className="secondary-button"
          type="button"
          disabled={snapshot.reviewPending}
          onClick={() => controller.closeReview()}
        >
          Close
        </button>
      </header>
      <section id="map-suggestion-card" className="map-suggestion-card" aria-live="polite">
        <div className="suggestion-heading">
          <div>
            <p className="eyebrow">Add to My Map?</p>
            <label>
              Note category{' '}
              <select
                aria-describedby="note-review-error"
                ref={bind}
                id="map-suggestion-category"
                aria-label="Note category"
                value={category}
                onChange={(event) => setCategory(event.target.value as EntryCategory)}
              >
                {Object.entries(entryChoices).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <span id="map-suggestion-topic" className="suggestion-topic">
            {suggestion.topic_title
              ? `Topic: ${suggestion.topic_title}`
              : 'Not connected to a topic yet'}
          </span>
        </div>
        {spaces.length > 0 && (
          <label id="map-suggestion-target-field" className="suggestion-target-field">
            <span>Save under</span>
            <select
              aria-describedby="note-review-error"
              ref={bind}
              id="map-suggestion-target"
              aria-label="Topic for this map suggestion"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">Overall</option>
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <textarea
          aria-describedby="note-review-error"
          ref={bind}
          id="map-suggestion-text"
          rows={2}
          aria-label="Edit map suggestion"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {(category === 'task' ||
          category === 'practice' ||
          goal ||
          map.snapshot.data?.categories?.some(
            (item) => item.kind === 'entry' && item.key === category && item.supports_completion,
          )) && (
          <label>
            Desired outcome (optional)
            <textarea
              ref={bind}
              aria-label="Desired outcome"
              rows={2}
              maxLength={1000}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </label>
        )}
        <p id="map-suggestion-reason" className="suggestion-reason">
          {suggestion.reason}
        </p>
        <div className="suggestion-actions">
          <button
            ref={bind}
            id="map-suggestion-dismiss"
            className="secondary-button"
            type="button"
            disabled={snapshot.reviewPending}
            onClick={() => decide(false)}
          >
            Not now
          </button>
          <button
            ref={bind}
            id="map-suggestion-accept"
            className="primary-button small"
            type="button"
            disabled={snapshot.reviewPending}
            onClick={() => decide(true)}
          >
            Save to map
          </button>
        </div>
        {snapshot.error && (
          <p id="note-review-error" className="review-error form-error" role="alert">
            {snapshot.error}
          </p>
        )}
      </section>
    </DialogFrame>
  );
}

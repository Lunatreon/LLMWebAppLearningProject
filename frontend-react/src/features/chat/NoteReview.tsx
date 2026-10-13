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
  const [text, setText] = useState(suggestion.text),
    [category, setCategory] = useState<EntryCategory>(
      Object.hasOwn(entryCategories, suggestion.category) ? suggestion.category : 'own_perception',
    );
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
      chat_id: suggestion.source_chat_id || snapshot.active!,
      accepted,
      category,
      text: text.trim() || suggestion.text,
      reason: suggestion.reason,
      topic_space_id: spaces.length ? target || null : suggestion.topic_space_id,
    });
  }
  return (
    <DialogFrame
      id="map-suggestion-review-dialog"
      dialogClass="chat-review-dialog"
      label="Keep this in your map?"
      controls={controls}
      focus={heading}
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
                {Object.entries(entryCategories).map(([value, label]) => (
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

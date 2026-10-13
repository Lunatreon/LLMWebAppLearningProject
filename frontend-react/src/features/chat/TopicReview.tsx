import { useId, useRef, useState } from 'react';
import { useMap } from '../map/MapContext';
import { DialogFrame, useDialogControls } from '../../components/shared/DialogFrame';
import { useChat } from './ChatContext';
import { entryCategories, topicCategories, topicCategoryOf } from '../../types/map';
import type { EntryCategory, TopicCategory, MapTopic } from '../../types/map';
import type { TopicSuggestion } from './types';

function contents(topic: MapTopic) {
  const chats = topic.chat_ids?.length || 0,
    journals = topic.journal_dates?.length || 0;
  return `${chats} ${chats === 1 ? 'chat' : 'chats'} and ${journals} ${journals === 1 ? 'journal' : 'journals'}`;
}
export default function TopicReview({
  suggestion,
  hidden,
}: {
  suggestion: TopicSuggestion;
  hidden: boolean;
}) {
  const { controller, snapshot } = useChat(),
    map = useMap();
  const spaces = snapshot.mapAccess ? map.snapshot.data?.topic_spaces || [] : [];
  const [title, setTitle] = useState(suggestion.topic),
    [description, setDescription] = useState(suggestion.description);
  const [target, setTarget] = useState(
    spaces.some((space) => space.id === suggestion.existing_topic_id)
      ? suggestion.existing_topic_id!
      : '',
  );
  const [parent, setParent] = useState(
    spaces.some((space) => space.id === suggestion.parent_topic_id)
      ? suggestion.parent_topic_id!
      : '',
  );
  const [related, setRelated] = useState(suggestion.related_topic_ids || []),
    [entryCategory, setEntryCategory] = useState<EntryCategory>('own_perception');
  const initial = spaces.find((space) => space.id === target);
  const [category, setCategory] = useState<TopicCategory>(
    initial ? topicCategoryOf(initial) : suggestion.category || 'other',
  );
  const selected = spaces.find((space) => space.id === target),
    recommended = Boolean(selected && selected.id === suggestion.existing_topic_id);
  const name = useId(),
    heading = useRef<HTMLHeadingElement>(null);
  const { controls, bind } = useDialogControls();
  const routing = snapshot.mapAccess && Boolean(spaces.length),
    pending = snapshot.reviewPending;
  const ordered = [...spaces].sort((a, b) => {
    if (a.id === suggestion.existing_topic_id) return -1;
    if (b.id === suggestion.existing_topic_id) return 1;
    return a.title.localeCompare(b.title);
  });
  let acceptLabel = 'Save topic';
  if (routing) {
    acceptLabel = selected ? 'Add to topic' : 'Create and connect';
  }
  function decide(accepted: boolean) {
    void controller.decideTopic({
      chat_id: suggestion.chat_id,
      require_map_access: true,
      suggestion_id: suggestion.suggestion_id || null,
      entry_category: entryCategory,
      topic: title.trim() || suggestion.topic,
      description: description.trim() || suggestion.description,
      category,
      related_topic_ids: related.filter((id) => id !== target),
      accepted,
      existing_topic_space_id: accepted && target ? target : null,
      parent_topic_space_id: accepted && !target && parent ? parent : null,
    });
  }
  return (
    <DialogFrame
      id="topic-review-dialog"
      dialogClass="chat-review-dialog"
      label="A possible thread"
      hidden={hidden}
      focus={heading}
      controls={controls}
      backdropClose={false}
      onClose={() => controller.closeReview()}
    >
      <header className="chat-review-header">
        <h2 id="topic-review-heading" ref={heading} tabIndex={-1}>
          A possible thread
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
      <section id="topic-card" className="topic-card" aria-live="polite">
        <div className="topic-copy">
          <span className="topic-mark" aria-hidden="true">
            ✦
          </span>
          <div className="topic-proposal">
            <div className="topic-eyebrow-row">
              <p className="eyebrow">A possible thread</p>
              {(suggestion.queue_total || 1) > 1 && (
                <span id="topic-queue-status" className="topic-queue-status">
                  Suggestion {suggestion.queue_position || 1} of {suggestion.queue_total}
                </span>
              )}
            </div>
            <label className="topic-field">
              <span id="topic-name-label">{selected ? 'Detected aspect' : 'New topic name'}</span>
              <input
                aria-describedby="topic-review-error"
                ref={bind}
                id="topic-title"
                type="text"
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="topic-field">
              <span>Topic type</span>
              <div className="topic-type-choices" role="radiogroup" aria-label="Topic type">
                {Object.entries(topicCategories).map(([value, label]) => (
                  <label key={value}>
                    <input
                      aria-describedby="topic-review-error"
                      ref={bind}
                      type="radio"
                      name={name}
                      value={value}
                      checked={category === value}
                      onChange={() => setCategory(value as TopicCategory)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="topic-field">
              <span>Description</span>
              <textarea
                aria-describedby="topic-review-error"
                ref={bind}
                id="topic-description"
                rows={2}
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </div>
        </div>
        {routing && (
          <div id="topic-routing" className="topic-routing">
            <label>
              <span>Connect this part of the chat to</span>
              <select
                aria-describedby="topic-review-error"
                ref={bind}
                id="topic-target"
                aria-label="Connect this chat to a topic"
                value={target}
                onChange={(event) => {
                  const id = event.target.value;
                  setTarget(id);
                  const space = spaces.find((space) => space.id === id);
                  setCategory(space ? topicCategoryOf(space) : suggestion.category || 'other');
                }}
              >
                <option value="">Create a new map topic</option>
                {ordered.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.id === suggestion.existing_topic_id
                      ? 'Recommended: '
                      : 'Existing topic: '}
                    {space.title}
                  </option>
                ))}
              </select>
            </label>
            {recommended && (
              <span id="topic-match-badge" className="topic-match-badge">
                Recommended match
              </span>
            )}
            <p id="topic-route-hint">
              {selected
                ? `${recommended ? 'Best match found. ' : ''}This chat will join “${selected.title}” (${contents(selected)}), so no extra map bubble is created. The same chat can also belong to other topics. Your description will also be saved as a note in this topic.`
                : 'This creates a new map topic and connects this chat to it. Its name is independent from the conversation name.'}
            </p>
            {!selected && (
              <label id="topic-parent-field">
                <span>Optional broader topic</span>
                <select
                  aria-describedby="topic-review-error"
                  ref={bind}
                  id="topic-parent"
                  aria-label="Parent topic"
                  value={parent}
                  onChange={(event) => setParent(event.target.value)}
                >
                  <option value="">No broader topic</option>
                  {spaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        <div id="topic-connections">
          {spaces.some((space) => space.id !== target) && (
            <fieldset className="map-related-picker">
              <legend>Connect related topics</legend>
              {spaces
                .filter((space) => space.id !== target)
                .map((space) => (
                  <label key={space.id}>
                    <input
                      aria-describedby="topic-review-error"
                      ref={bind}
                      type="checkbox"
                      value={space.id}
                      checked={related.includes(space.id)}
                      onChange={(event) =>
                        setRelated((ids) =>
                          event.target.checked
                            ? [...ids, space.id]
                            : ids.filter((id) => id !== space.id),
                        )
                      }
                    />
                    {space.title}
                  </label>
                ))}
            </fieldset>
          )}
        </div>
        {selected && (
          <label id="topic-entry-category-field" className="topic-field">
            <span>Save the description as a note in this topic</span>
            <select
              aria-describedby="topic-review-error"
              ref={bind}
              id="topic-entry-category"
              aria-label="Note category for existing topic"
              value={entryCategory}
              onChange={(event) => setEntryCategory(event.target.value as EntryCategory)}
            >
              {Object.entries(entryCategories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="topic-actions">
          <button
            ref={bind}
            id="topic-dismiss"
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={() => decide(false)}
          >
            Not this
          </button>
          <button
            ref={bind}
            id="topic-accept"
            className="primary-button small"
            type="button"
            disabled={pending}
            onClick={() => decide(true)}
          >
            {acceptLabel}
          </button>
        </div>
        {snapshot.error && (
          <p id="topic-review-error" className="review-error form-error" role="alert">
            {snapshot.error}
          </p>
        )}
      </section>
    </DialogFrame>
  );
}

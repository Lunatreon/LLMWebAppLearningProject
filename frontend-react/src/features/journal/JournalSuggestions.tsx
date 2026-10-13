import { useEffect, useId, useState } from 'react';
import { useJournal } from './JournalContext';
import { entryCategories, topicCategories, categoryLabels, journalTopicCategory } from './types';
import type { JournalSuggestion, TopicCategory } from './types';

function SuggestionCard({ suggestion }: { suggestion: JournalSuggestion }) {
  const { snapshot, controller } = useJournal();
  const [title, setTitle] = useState(suggestion.title);
  const [text, setText] = useState(suggestion.text);
  const [type, setType] = useState<TopicCategory>(suggestion.topic_category || 'other');
  let defaultCategory = 'own_perception';
  if (suggestion.kind !== 'topic' && Object.hasOwn(entryCategories, suggestion.category)) {
    defaultCategory = suggestion.category;
  }
  const [category, setCategory] = useState(defaultCategory);
  const [topic, setTopic] = useState('');
  const radioName = useId();
  const reviewed = suggestion.status !== 'pending';
  const busy = snapshot.deciding.includes(suggestion.id);
  useEffect(() => {
    if (suggestion.status !== 'pending') {
      setTitle(suggestion.title);
      setText(suggestion.text);
      setType(suggestion.topic_category || 'other');
      setTopic('');
      setCategory(defaultCategory);
    }
  }, [suggestion]);
  const topicSuggestion = suggestion.kind === 'topic';
  const categorySelect = (
    <select
      aria-label={topicSuggestion ? 'Note category for existing topic' : 'Map category'}
      hidden={topicSuggestion && !topic}
      disabled={reviewed}
      value={category}
      onChange={(event) => setCategory(event.target.value)}
    >
      {Object.entries(entryCategories).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
  return (
    <article className="journal-suggestion" data-status={suggestion.status}>
      <span className="journal-suggestion-kind">
        {topicSuggestion
          ? 'Possible topic'
          : categoryLabels[suggestion.category as keyof typeof categoryLabels] ||
            suggestion.category}
      </span>
      {topicSuggestion && (
        <>
          <input
            name="journal_topic_title"
            aria-label="Topic title"
            maxLength={120}
            disabled={reviewed}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="map-action-field">
            Topic type
            <div className="topic-type-choices" role="radiogroup" aria-label="Topic type">
              {Object.entries(topicCategories).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={radioName}
                    value={value}
                    checked={type === value}
                    disabled={reviewed}
                    onChange={() => setType(value as TopicCategory)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
      <textarea
        name="journal_suggestion_text"
        maxLength={1000}
        aria-label={topicSuggestion ? 'Topic description' : 'Map entry'}
        disabled={reviewed}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {!topicSuggestion && categorySelect}
      <select
        name={topicSuggestion ? 'journal_topic_space_id' : 'journal_map_topic_space_id'}
        aria-label={topicSuggestion ? 'Connect this journal page to a topic' : 'Connect to topic'}
        disabled={reviewed}
        value={topic}
        onChange={(event) => {
          const value = event.target.value;
          setTopic(value);
          const target = snapshot.topics.find((item) => item.id === value);
          if (topicSuggestion)
            setType(target ? journalTopicCategory(target) : suggestion.topic_category || 'other');
        }}
      >
        <option value="">
          {topicSuggestion ? `Create “${suggestion.title || 'new topic'}”` : 'Overall'}
        </option>
        {snapshot.topics.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      {topicSuggestion && categorySelect}
      <p className="journal-suggestion-reason">{suggestion.reason}</p>
      {!reviewed ? (
        <div className="journal-suggestion-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void controller.decide(suggestion.id, { accepted: false })}
          >
            Not this
          </button>
          <button
            className="primary-button small"
            type="button"
            disabled={busy}
            onClick={() =>
              void controller.decide(suggestion.id, {
                accepted: true,
                title: topicSuggestion ? title || null : null,
                topic_category: topicSuggestion ? type : null,
                text,
                category: category || null,
                topic_space_id: topic || null,
              })
            }
          >
            {topicSuggestion ? 'Save topic' : 'Add to map'}
          </button>
        </div>
      ) : (
        <strong>{suggestion.status === 'saved' ? 'Saved to My Map' : 'Dismissed'}</strong>
      )}
    </article>
  );
}
export default function JournalSuggestions() {
  const { snapshot, controller } = useJournal();
  const suggestions = snapshot.draft.entry?.suggestions || [];
  if (!suggestions.length) return null;
  return (
    <section id="journal-suggestions" className="journal-suggestions" aria-live="polite">
      <div className="journal-suggestions-heading">
        <div>
          <p className="eyebrow">Optional map additions</p>
          <h3>Keep only what feels true</h3>
        </div>
      </div>
      {snapshot.topicsError && (
        <div role="alert">
          <p>{snapshot.topicsError}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void controller.loadTopics()}
          >
            Retry topics
          </button>
        </div>
      )}
      <div id="journal-suggestion-list" className="journal-suggestion-list">
        {suggestions.map((item) => (
          <SuggestionCard key={`${snapshot.selected}:${item.id}`} suggestion={item} />
        ))}
      </div>
    </section>
  );
}

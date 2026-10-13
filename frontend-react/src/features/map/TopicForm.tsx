import { useId, useRef, useState } from 'react';
import { useMap } from './MapContext';
import type { MapPopup } from './MapController';
import { topicCategories, topicCategoryOf } from '../../types/map';
import type { TopicCategory } from '../../types/map';
import { DialogFrame, useDialogControls } from '../../components/shared/DialogFrame';

export default function TopicForm({ popup }: { popup: Extract<MapPopup, { kind: 'topic' }> }) {
  const { controller, snapshot } = useMap();
  const topics = snapshot.data?.topic_spaces || [];
  const topic = topics.find((value) => value.id === popup.id);
  const [title, setTitle] = useState(topic?.title || ''),
    [description, setDescription] = useState(topic?.description || '');
  const [category, setCategory] = useState<TopicCategory>(
    topicCategoryOf(topic || { id: '', title: '' }),
  );
  const [parent, setParent] = useState(topic?.parent_topic_id || ''),
    [related, setRelated] = useState(topic?.related_topic_ids || []),
    [merge, setMerge] = useState('');
  const others = topics.filter((value) => value.id !== popup.id);
  const edit = Boolean(popup.id);
  const radioName = useId();
  const { controls, bind } = useDialogControls();
  const input = useRef<HTMLInputElement>(null);
  const busy = Boolean(snapshot.pending.length);
  async function save() {
    if (!title.trim() || busy) return;
    const success = await controller.saveTopic(
      {
        title: title.trim(),
        category,
        description: description.trim(),
        parent_topic_id: parent || null,
        related_topic_ids: related,
      },
      popup.id,
    );
    if (success) controller.closePopup();
  }
  return (
    <DialogFrame
      label={edit ? 'Edit topic' : 'Add topic'}
      controls={controls}
      focus={input}
      busy={busy}
      hidden={!snapshot.enabled}
      inert={Boolean(snapshot.confirmation)}
      onClose={() => controller.closePopup()}
    >
      <button
        ref={bind}
        className="map-action-close"
        type="button"
        aria-label="Close"
        disabled={busy}
        onClick={() => controller.closePopup()}
      >
        x
      </button>
      <p className="eyebrow">Self-authorship map</p>
      <h3>{edit ? 'Edit topic' : 'Add a topic'}</h3>
      <form
        className="map-action-form"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <input
          aria-describedby="map-topic-error"
          ref={(node) => {
            input.current = node;
            bind(node);
          }}
          type="text"
          name="topic_title"
          required
          maxLength={120}
          placeholder="Dad, Curious, Healing..."
          aria-label="Topic name"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="map-action-field">
          Topic type
          <div className="topic-type-choices" role="radiogroup" aria-label="Topic type">
            {Object.entries(topicCategories).map(([value, label]) => (
              <label key={value}>
                <input
                  aria-describedby="map-topic-error"
                  ref={bind}
                  type="radio"
                  name={radioName}
                  value={value}
                  checked={category === value}
                  onChange={() => setCategory(value as TopicCategory)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        <textarea
          aria-describedby="map-topic-error"
          ref={bind}
          name="topic_description"
          rows={3}
          maxLength={2000}
          placeholder="A short note about what this means in your life"
          aria-label="Topic description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label className="map-action-field">
          <span>Broader topic</span>
          <select
            aria-describedby="map-topic-error"
            ref={bind}
            name="parent_topic_id"
            value={parent}
            onChange={(event) => setParent(event.target.value)}
          >
            <option value="">No parent topic</option>
            {others.map((value) => (
              <option key={value.id} value={value.id}>
                {value.title}
              </option>
            ))}
          </select>
        </label>
        <fieldset className={`map-related-picker${others.length ? '' : ' hidden'}`}>
          <legend>Connect related topics</legend>
          {others.map((value) => (
            <label key={value.id}>
              <input
                aria-describedby="map-topic-error"
                ref={bind}
                type="checkbox"
                name="related_topic_ids"
                value={value.id}
                checked={related.includes(value.id)}
                onChange={(event) =>
                  setRelated((ids) =>
                    event.target.checked ? [...ids, value.id] : ids.filter((id) => id !== value.id),
                  )
                }
              />
              <span>{value.title}</span>
            </label>
          ))}
        </fieldset>
        {edit && others.length > 0 && (
          <section className="map-topic-merge">
            <strong>Duplicate topic?</strong>
            <p>
              Move this topic’s chats, journals, and entries into another topic, then remove this
              bubble.
            </p>
            <select
              aria-describedby="map-topic-error"
              ref={bind}
              aria-label="Topic to merge into"
              value={merge}
              onChange={(event) => setMerge(event.target.value)}
            >
              <option value="">Choose the topic to keep</option>
              {others.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.title}
                </option>
              ))}
            </select>
            <button
              ref={bind}
              className="map-merge-button"
              type="button"
              disabled={!merge || busy}
              onClick={() => {
                const target = topics.find((value) => value.id === merge);
                if (target && topic)
                  controller.confirm(
                    `Merge “${topic.title}” into “${target.title}”? The second topic will be kept.`,
                    () => {
                      void controller.merge(topic.id, target.id).then((success) => {
                        if (success) controller.closePopup();
                      });
                    },
                  );
              }}
            >
              Merge into selected topic
            </button>
          </section>
        )}
        <button ref={bind} type="submit" disabled={busy}>
          {edit ? 'Save topic' : 'Create topic'}
        </button>
        {snapshot.error && (
          <p id="map-topic-error" className="map-form-error" role="alert">
            {snapshot.error}
          </p>
        )}
      </form>
    </DialogFrame>
  );
}

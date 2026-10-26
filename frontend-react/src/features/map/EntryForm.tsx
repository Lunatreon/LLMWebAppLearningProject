import { useRef, useState } from 'react';
import { useMap } from './MapContext';
import type { MapPopup } from './MapController';
import { mapNodes } from './mapLayout';
import { categoryLabels } from '../../types/map';
import type { EntryCategory } from '../../types/map';
import { DialogFrame, useDialogControls } from '../../components/shared/DialogFrame';

export default function EntryForm({ popup }: { popup: Exclude<MapPopup, { kind: 'topic' }> }) {
  const { controller, snapshot } = useMap();
  const nodes = snapshot.data ? mapNodes(snapshot.data) : [];
  const node = nodes.find((value) => value.id === popup.nodeId);
  const entry = nodes
    .flatMap((value) => value.entries || [])
    .find((value) => value.id === popup.entryId);
  const task = popup.kind === 'task',
    edit = Boolean(popup.entryId),
    practice = task || entry?.category === 'practice';
  const [text, setText] = useState(entry?.text || ''),
    [target, setTarget] = useState(node?.kind === 'topic' ? node.id : '');
  const labels = snapshot.data?.categories
    ? Object.fromEntries(
        snapshot.data.categories
          .filter((c) => c.kind === 'entry' && (c.active || c.key === entry?.category))
          .map((c) => [c.key, c.label]),
      )
    : categoryLabels;
  const categories = Object.keys(labels).filter(
    (key) => key !== 'practice' && (key !== 'merged_topic' || entry?.category === key),
  );
  const [category, setCategory] = useState<EntryCategory>(
    entry?.category ||
      (Object.hasOwn(labels, 'own_perception')
        ? 'own_perception'
        : categories[0] || 'own_perception'),
  );
  const [completion, setCompletion] = useState(entry?.completion_percent?.toString() || '');
  const [workingOn, setWorkingOn] = useState(entry?.working_on ?? false);
  const { controls, bind } = useDialogControls();
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = Boolean(snapshot.pending.length);
  let dialogLabel: string;
  let heading: string;
  let submitLabel: string;
  if (edit) {
    dialogLabel = 'Edit entry';
    heading = practice ? 'Edit practice' : 'Edit entry';
    submitLabel = 'Save changes';
  } else if (task) {
    dialogLabel = 'Add practice';
    heading = 'Add a practice';
    submitLabel = 'Save practice';
  } else {
    dialogLabel = 'Add entry';
    heading = 'Add an entry';
    submitLabel = 'Save entry';
  }
  return (
    <DialogFrame
      label={dialogLabel}
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
      <p className="eyebrow">{node?.title || 'Map entry'}</p>
      <h3>{heading}</h3>
      <form
        className="map-action-form"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim() || busy) return;
          void controller
            .saveEntry(
              {
                category: practice ? 'practice' : category,
                text: text.trim(),
                ...(workingOn !== Boolean(entry?.working_on) ? { working_on: workingOn } : {}),
                ...(completion !== ''
                  ? { completion_percent: Number(completion) }
                  : entry?.completion_percent != null
                    ? { completion_percent: null }
                    : {}),
                topic_space_id: target || null,
              },
              popup.nodeId,
              popup.entryId,
            )
            .then((success) => {
              if (success) controller.closePopup();
            });
        }}
      >
        {!practice && (
          <select
            aria-describedby="map-entry-error"
            ref={bind}
            aria-label="Entry type"
            value={category}
            onChange={(event) => setCategory(event.target.value as EntryCategory)}
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </select>
        )}
        <select
          aria-describedby="map-entry-error"
          ref={bind}
          name="topic_space_id"
          aria-label="Topic for this entry"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">Overall</option>
          {snapshot.data?.topic_spaces.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.title}
            </option>
          ))}
        </select>
        <label>
          <input
            ref={bind}
            type="checkbox"
            checked={workingOn}
            onChange={(event) => setWorkingOn(event.target.checked)}
          />
          Working on
        </label>
        <label>
          Completion (%)
          <input
            ref={bind}
            type="number"
            min={0}
            max={100}
            step={1}
            aria-label="Completion percentage"
            value={completion}
            onChange={(event) => setCompletion(event.target.value)}
          />
        </label>
        <textarea
          aria-describedby="map-entry-error"
          ref={(node) => {
            input.current = node;
            bind(node);
          }}
          name="entry_text"
          rows={4}
          required
          aria-label="Entry text"
          placeholder={
            task
              ? 'What repeatable practice belongs to this topic?'
              : 'What observation do you want to save here?'
          }
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button ref={bind} type="submit" disabled={busy}>
          {submitLabel}
        </button>
        {snapshot.error && (
          <p id="map-entry-error" className="map-form-error" role="alert">
            {snapshot.error}
          </p>
        )}
      </form>
    </DialogFrame>
  );
}

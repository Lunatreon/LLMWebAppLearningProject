import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { categoryLabels } from '../../types/map';
import type { MapEntry } from '../../types/map';
import { textPreview } from './mapLayout';
import type { MapNodeData } from './mapLayout';
import { useMap } from './MapContext';

export default function EntryPreview({ node, entry }: { node: MapNodeData; entry: MapEntry }) {
  const { controller, snapshot } = useMap();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const preview = textPreview(entry.text);
  const practice = entry.category === 'practice';
  const completed = entry.status === 'completed';
  let practiceStatus = 'Active';
  let practiceAction = 'Pause';
  let practiceMenuAction = 'Pause practice';
  if (completed) {
    practiceStatus = 'Completed';
    practiceAction = 'Practice again';
    practiceMenuAction = 'Practice again';
  } else if (entry.status === 'paused') {
    practiceStatus = 'Paused';
    practiceAction = 'Resume';
    practiceMenuAction = 'Resume practice';
  }
  const disabled =
    !snapshot.enabled ||
    snapshot.errorStatus === 403 ||
    snapshot.pending.includes(`entry:${entry.id}`);
  const completeLink = (label: string) => (
    <Link
      to={{ pathname: '/reflection', search: location.search }}
      state={{ workspace: 'map', returnTo: '/map', practiceId: entry.id }}
      onClick={() => controller.closeMenu()}
    >
      {label}
    </Link>
  );
  return (
    <article data-category={entry.category} className={snapshot.menu === entry.id ? 'open' : ''}>
      <div className="map-entry-preview-head">
        <span className="map-entry-type">{categoryLabels[entry.category] || entry.category}</span>
        <button
          className="map-entry-menu-button"
          type="button"
          aria-label="Entry actions"
          aria-expanded={snapshot.menu === entry.id}
          onClick={(event) => {
            event.stopPropagation();
            controller.toggleMenu(entry.id);
          }}
        >
          ...
        </button>
      </div>
      <p className="map-entry-text" title={entry.text}>
        <span>{expanded ? preview.full : preview.preview}</span>
        {preview.truncated && (
          <>
            {' '}
            <button
              className="map-entry-more"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'less' : 'more'}
            </button>
          </>
        )}
      </p>
      {practice && (
        <div className="map-task-panel">
          <span className="map-task-status" data-status={entry.status || 'active'}>
            {practiceStatus}
          </span>
          {entry.reflection && <p className="map-task-reflection">{entry.reflection}</p>}
          <div className="map-task-actions">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void controller.practice(
                  entry.id,
                  completed || entry.status === 'paused' ? 'active' : 'paused',
                )
              }
            >
              {snapshot.pending.includes(`entry:${entry.id}`) ? 'Saving...' : practiceAction}
            </button>
            {!completed && completeLink('Complete')}
          </div>
        </div>
      )}
      <div className="map-entry-menu" hidden={snapshot.menu !== entry.id}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            controller.closeMenu();
            controller.openEntry(node.id, false, entry.id);
          }}
        >
          Edit
        </button>
        {practice && (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                controller.closeMenu();
                void controller.practice(
                  entry.id,
                  completed || entry.status === 'paused' ? 'active' : 'paused',
                );
              }}
            >
              {practiceMenuAction}
            </button>
            {!completed && completeLink('Complete practice')}
          </>
        )}
        <button
          className="danger"
          type="button"
          disabled={disabled}
          onClick={() => {
            controller.closeMenu();
            controller.confirm(
              'Delete this map entry? This cannot be undone.',
              () => void controller.deleteEntry(entry.id),
            );
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

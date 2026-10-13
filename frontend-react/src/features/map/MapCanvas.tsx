import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useMap } from './MapContext';
import { useMobileLayout } from '../../hooks/useMobileLayout';
import { mapEdges, primaryCategory, visibleLayout } from './mapLayout';
export default function MapCanvas() {
  const { controller, snapshot } = useMap();
  const mobile = useMobileLayout();
  const layout = useMemo(
    () =>
      snapshot.data
        ? visibleLayout(snapshot.data, snapshot.filter, mobile)
        : { nodes: [], height: undefined },
    [snapshot.data, snapshot.filter, mobile],
  );
  const edges = useMemo(() => mapEdges(layout.nodes), [layout.nodes]);
  return (
    <div
      className="map-concept-board"
      aria-label="Interactive concept map"
      style={layout.height ? { height: layout.height, minHeight: layout.height } : undefined}
    >
      <svg
        className="map-connection-layer"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {edges.map((edge) => (
          <line
            key={edge.key}
            data-edge={edge.key}
            className={`map-topic-link map-topic-link-${edge.type}`}
            x1={edge.source.position.x}
            y1={edge.source.position.y}
            x2={edge.target.position.x}
            y2={edge.target.position.y}
          />
        ))}
      </svg>
      {layout.nodes.map((node, index) => {
        const chats = node.chat_ids?.length || 0,
          journals = node.journal_dates?.length || 0,
          entries = node.entries?.length || 0;
        const journalLabel = `${journals} ${journals === 1 ? 'journal entry' : 'journal entries'}`;
        let meta: string;
        if (node.id === snapshot.selected && !snapshot.detailOpen) {
          meta = 'Open details';
        } else if (node.parent_title) {
          meta = `Under ${node.parent_title} · ${journalLabel}`;
        } else {
          const chatLabel = `${chats} ${chats === 1 ? 'chat' : 'chats'}`;
          const entryLabel = `${entries} ${entries === 1 ? 'entry' : 'entries'}`;
          meta = `${chatLabel} · ${journalLabel} · ${entryLabel}`;
        }
        return (
          <button
            key={node.id}
            type="button"
            className={`map-node${node.kind === 'unassigned' ? ' overall' : ''}`}
            data-category={primaryCategory(node.entries || [])}
            title={node.title}
            aria-pressed={node.id === snapshot.selected}
            aria-label={`Open ${node.title}`}
            style={
              {
                left: `${node.position.x}%`,
                top: `${node.position.y}%`,
                '--node-delay': `${index * 90}ms`,
              } as CSSProperties
            }
            onClick={() => controller.select(node.id)}
          >
            <strong>{node.title}</strong>
            <span>{meta}</span>
          </button>
        );
      })}
      {!layout.nodes.length && (
        <p className="map-filter-empty">
          {snapshot.data?.topic_spaces.length
            ? 'No topics of this type yet. You can choose a type in Edit & connect.'
            : 'Add a person, a trait, or an experience to begin your map.'}
        </p>
      )}
    </div>
  );
}

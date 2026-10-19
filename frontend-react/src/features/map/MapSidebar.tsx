import { useContext } from 'react';
import type { CSSProperties } from 'react';
import { MapContext } from './MapContext';
import { orderedTopics, overallNode, OVERALL_ID } from './mapLayout';
import type { MapTopic } from '../../types/map';
export default function MapSidebar({
  allowed,
  onClose,
}: {
  allowed: boolean;
  onClose: () => void;
}) {
  const map = useContext(MapContext);
  const accessible = allowed && !map?.snapshot.denied;
  const topics = accessible ? (map?.snapshot.data?.topic_spaces ?? []) : [];
  function topicButton(topic: MapTopic, depth = 0) {
    const chats = topic.chat_ids?.length || 0,
      entries = topic.entries?.length || 0;
    const meta = `${chats} ${chats === 1 ? 'chat' : 'chats'} · ${entries} ${entries === 1 ? 'entry' : 'entries'}`;
    return (
      <button
        key={topic.id}
        type="button"
        className={`map-topic-button${topic.id === OVERALL_ID ? ' overall' : ''}${map?.snapshot.selected === topic.id ? ' active' : ''}`}
        style={{ '--topic-indent': `${Math.min(depth, 5) * 14}px` } as CSSProperties}
        aria-current={map?.snapshot.selected === topic.id ? 'page' : 'false'}
        aria-label={`${topic.title || 'Untitled topic'} ${meta}`}
        title={`${topic.title || 'Untitled topic'} — ${meta}`}
        onClick={() => {
          map?.controller.select(topic.id);
          onClose();
        }}
      >
        <strong>{topic.title || 'Untitled topic'}</strong>
        <span>{meta}</span>
      </button>
    );
  }
  return (
    <section id="map-sidebar-content" className="sidebar-context map-sidebar-content">
      {!accessible ? (
        <div id="map-sidebar-locked" className="map-sidebar-locked">
          <span className="workspace-premium-badge">Pro</span>
          <strong>My Map is a Premium space</strong>
          <p>Unlock connected topics, conversations, and practices.</p>
        </div>
      ) : (
        <div id="map-sidebar-access" className="map-sidebar-access">
          <button
            id="map-sidebar-add-topic"
            className="map-sidebar-add-topic new-chat-button"
            type="button"
            disabled={
              !map?.snapshot.enabled ||
              !map.snapshot.data ||
              map.snapshot.errorStatus === 403 ||
              Boolean(map.snapshot.pending.length)
            }
            title={!map ? 'Topic creation is not migrated yet' : undefined}
            onClick={() => {
              onClose();
              map?.controller.openTopic();
            }}
          >
            <span className="button-icon" aria-hidden="true">
              +
            </span>
            <span>Create topic</span>
          </button>
          <div className="map-topic-list-heading">
            <span>Topics</span>
            <span id="map-topic-count">{map ? topics.length + 1 : 0}</span>
          </div>
          <nav id="map-topic-list" className="map-topic-list" aria-label="Map topics">
            {map ? (
              <>
                {topicButton(overallNode(map.snapshot.data))}
                {orderedTopics(topics).map(({ topic, depth }) => topicButton(topic, depth))}
              </>
            ) : (
              <p className="empty-state">Topics are not loaded in this preview.</p>
            )}
          </nav>
        </div>
      )}
    </section>
  );
}

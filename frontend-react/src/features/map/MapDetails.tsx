import { useContext } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { categoryLabels, topicCategories, topicCategoryOf } from '../../types/map';
import type { MapTopic } from '../../types/map';
import { categoryCounts } from './mapLayout';
import type { MapNodeData } from './mapLayout';
import { useMap } from './MapContext';
import { ChatContext } from '../chat/ChatContext';
import EntryPreview from './EntryPreview';

export default function MapDetails({ node }: { node: MapNodeData }) {
  const { controller, snapshot } = useMap();
  const navigate = useNavigate();
  const location = useLocation();
  const chat = useContext(ChatContext);
  const entries = node.entries || [],
    chats = node.chat_ids?.length || 0
  const disabled =
    !snapshot.enabled || snapshot.errorStatus === 403 || Boolean(snapshot.pending.length);
  const topics = snapshot.data?.topic_spaces || [];
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const connections: { relationship: string; topic: MapTopic }[] = [];
  const parent = byId.get(node.parent_topic_id || '');
  if (parent) connections.push({ relationship: 'Under', topic: parent });
  topics
    .filter((topic) => topic.parent_topic_id === node.id)
    .forEach((topic) => connections.push({ relationship: 'Contains', topic }));
  (node.related_topic_ids || []).forEach((id) => {
    const topic = byId.get(id);
    if (topic) connections.push({ relationship: 'Related', topic });
  });
  const counts = Object.entries(categoryCounts(entries));
  return (
    <aside className="map-node-detail" aria-label={`${node.title} details`}>
      <button
        className="map-detail-close"
        type="button"
        aria-label="Close thread details"
        onClick={() => controller.closeDetails()}
      >
        x
      </button>
      <p className="eyebrow">
        {node.kind === 'unassigned' ? 'Across your map' : topicCategories[topicCategoryOf(node)]}
      </p>
      <div className="map-detail-title-row">
        <h3>{node.title}</h3>
        {node.kind === 'topic' && (
          <div className="map-title-actions">
            <button
              className="map-title-edit-button"
              type="button"
              disabled={disabled}
              onClick={() => controller.openTopic(node.id)}
            >
              Edit &amp; connect
            </button>
            <button
              className="map-title-edit-button danger"
              type="button"
              disabled={disabled}
              onClick={() =>
                controller.confirm(
                  'Delete this topic? Its entries will move to Overall instead of being deleted.',
                  () => void controller.deleteTopic(node.id),
                )
              }
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <p className="map-node-description">
        {node.description || 'A thread you chose to keep visible.'}
      </p>
      <div className="map-node-stats">
        <span>
          {chats} {chats === 1 ? 'chat' : 'chats'}
        </span>
        <span>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      <div className="map-node-signals">
        {counts.length ? (
          counts.map(([category, count]) => (
            <span key={category} data-category={category}>
              {categoryLabels[category as keyof typeof categoryLabels] || category} {count}
            </span>
          ))
        ) : (
          <span>No saved signals</span>
        )}
      </div>
      {node.kind === 'topic' && (
        <>
          {connections.length > 0 && (
            <section className="map-detail-section">
              <h4>Topic connections</h4>
              <div className="map-topic-connections">
                {connections.map(({ relationship, topic }) => (
                  <div key={`${relationship}:${topic.id}`} className="map-topic-connection-row">
                    <button
                      className="map-topic-connection-open"
                      type="button"
                      onClick={() => controller.select(topic.id)}
                    >
                      <span>{relationship}</span>
                      <strong>{topic.title}</strong>
                    </button>
                    <button
                      className="map-topic-connection-remove"
                      type="button"
                      disabled={disabled}
                      title={`Disconnect from ${topic.title}`}
                      aria-label={`Disconnect from ${topic.title}`}
                      onClick={() =>
                        controller.confirm(
                          `Disconnect “${node.title}” and “${topic.title}”? Both topics and their contents will be kept.`,
                          () => void controller.disconnect(node.id, relationship, topic.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {chats > 0 && (
            <section className="map-detail-section">
              <h4>Connected conversations</h4>
              <div className="map-connected-chats">
                {node.chat_ids!.map((id) => (
                  <Link
                    key={id}
                    to={{ pathname: '/chat', search: location.search }}
                    state={{ chatId: id }}
                  >
                    {chat?.snapshot.chats.find((item) => item.chat_id === id)?.title ||
                      'Conversation'}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <section className="map-thread-actions">
        <button
          className="map-thread-button"
          type="button"
          disabled={disabled}
          onClick={() => controller.openEntry(node.id)}
        >
          + Entry
        </button>
        <button
          className="map-thread-button"
          type="button"
          disabled={disabled}
          onClick={() => controller.openEntry(node.id, true)}
        >
          + Practice
        </button>
      </section>
      {entries.length > 0 ? (
        <div className="map-entry-preview">
          {entries
            .slice(-3)
            .reverse()
            .map((entry) => (
              <EntryPreview key={entry.id} node={node} entry={entry} />
            ))}
        </div>
      ) : (
        <p className="map-empty compact">No saved observations here yet.</p>
      )}
    </aside>
  );
}

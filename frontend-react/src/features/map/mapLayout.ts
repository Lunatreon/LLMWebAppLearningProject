import type { MapData, MapTopic, MapEntry, TopicCategory } from '../../types/map';
import { topicCategoryOf } from '../../types/map';
export const OVERALL_ID = '__across_topics';
export type MapFilter = TopicCategory | 'all';
export interface MapNodeData extends MapTopic {
  kind: 'topic' | 'unassigned';
  position: { x: number; y: number };
  parent_title?: string | null;
}
export const plurals = {
  person: 'People',
  trait: 'Traits',
  experience: 'Experiences',
  other: 'Other',
};
export function nodePosition(index: number) {
  const slots = [
    [50, 50],
    [23, 27],
    [78, 34],
    [28, 72],
    [68, 74],
    [50, 20],
    [18, 52],
    [84, 58],
    [42, 82],
  ];
  const [x, y] = slots[index % slots.length];
  const lap = Math.floor(index / slots.length);
  return {
    x: Math.min(88, Math.max(12, x + lap * 4)),
    y: Math.min(84, Math.max(16, y + (lap % 2 ? -6 : 6))),
  };
}
export function overallNode(map?: MapData | null): MapNodeData {
  const entries = map?.unassigned_entries ?? [];
  return {
    id: OVERALL_ID,
    kind: 'unassigned',
    title: 'Overall',
    description:
      'A permanent home for observations, values, evidence, and practices that matter across several topics.',
    chat_ids: [
      ...new Set(
        entries.map((entry) => entry.source_chat_id).filter((id): id is string => Boolean(id)),
      ),
    ],
    entries,
    position: nodePosition(0),
  };
}
export function mapNodes(map: MapData): MapNodeData[] {
  const titles = new Map(map.topic_spaces.map((topic) => [topic.id, topic.title || 'Untitled']));
  return [
    overallNode(map),
    ...map.topic_spaces.map((topic, index): MapNodeData => ({
      ...topic,
      kind: 'topic',
      title: topic.title || 'Untitled',
      description: topic.description || 'A thread you chose to keep visible.',
      parent_title: titles.get(topic.parent_topic_id || '') || null,
      related_topic_ids: topic.related_topic_ids || [],
      journal_dates: topic.journal_dates || [],
      entries: topic.entries || [],
      position: nodePosition(index + 1),
    })),
  ];
}
export function visibleLayout(map: MapData, filter: MapFilter, mobile: boolean) {
  let nodes = mapNodes(map).filter(
    (node) => filter === 'all' || (node.kind === 'topic' && topicCategoryOf(node) === filter),
  );
  if (!mobile) return { nodes, height: undefined };
  const overall = nodes[0]?.id === OVERALL_ID;
  const positions = nodes.map((_, index) => {
    if (overall && index === 0) return { x: 50, y: 64 };
    const slot = index - (overall ? 1 : 0);
    return {
      x: slot % 2 ? 74 : 26,
      y: (overall ? 184 : 64) + Math.floor(slot / 2) * 120 + (slot % 2) * 28,
    };
  });
  const height = Math.max(430, ...positions.map((position) => position.y + 76));
  nodes = nodes.map((node, index) => ({
    ...node,
    position: { x: positions[index].x, y: (positions[index].y / height) * 100 },
  }));
  return { nodes, height };
}
export function mapEdges(nodes: MapNodeData[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const edges: {
    key: string;
    type: 'parent' | 'related';
    source: MapNodeData;
    target: MapNodeData;
  }[] = [];
  for (const node of nodes) {
    const parent = byId.get(node.parent_topic_id || '');
    if (parent)
      edges.push({ key: `parent:${node.id}`, type: 'parent', source: parent, target: node });
    for (const id of node.related_topic_ids ?? []) {
      const key = [node.id, id].sort().join(':');
      const target = byId.get(id);
      if (!seen.has(key) && target) {
        seen.add(key);
        edges.push({ key: `related:${key}`, type: 'related', source: node, target });
      }
    }
  }
  return edges;
}
export function orderedTopics(topics: MapTopic[]) {
  const ids = new Set(topics.map((topic) => topic.id));
  const visited = new Set<string>();
  const ordered: { topic: MapTopic; depth: number }[] = [];
  function branch(topic: MapTopic, depth: number) {
    if (visited.has(topic.id)) return;
    visited.add(topic.id);
    ordered.push({ topic, depth });
    topics
      .filter((child) => child.parent_topic_id === topic.id)
      .forEach((child) => branch(child, depth + 1));
  }
  topics
    .filter((topic) => !ids.has(topic.parent_topic_id || ''))
    .forEach((topic) => branch(topic, 0));
  topics.forEach((topic) => branch(topic, 0));
  return ordered;
}
export function categoryCounts(entries: MapEntry[]) {
  return entries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.category] = (counts[entry.category] || 0) + 1;
    return counts;
  }, {});
}
export function primaryCategory(entries: MapEntry[]) {
  return (
    Object.entries(categoryCounts(entries)).sort((a, b) => b[1] - a[1])[0]?.[0] || 'own_perception'
  );
}
export function textPreview(text: string, limit = 86) {
  const full = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    full,
    preview: full.length > limit ? `${full.slice(0, limit - 3)}...` : full,
    truncated: full.length > limit,
  };
}

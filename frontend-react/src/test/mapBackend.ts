import { mockBackend, json } from './backend';
import type { MapData, MapTopic, MapEntry, EntryCategory } from '../types/map';
export const mapTimestamp = '2026-10-12T12:00:00+00:00';
export const topic = (id: string, title: string, extra: Partial<MapTopic> = {}): MapTopic => ({
  id,
  title,
  category: 'other',
  description: '',
  parent_topic_id: null,
  related_topic_ids: [],
  chat_ids: [],
  entries: [],
  created_at: mapTimestamp,
  updated_at: mapTimestamp,
  ...extra,
});
export const mapEntry = (
  id: string,
  text: string,
  category: EntryCategory = 'own_perception',
  extra: Partial<MapEntry> = {},
): MapEntry => ({
  id,
  text,
  category,
  source_chat_id: null,
  reason: null,
  created_at: mapTimestamp,
  updated_at: mapTimestamp,
  ...(category === 'practice' ? { status: 'active' as const, reflection: null } : {}),
  ...extra,
});
export const mapData = (topics: MapTopic[] = [], entries: MapEntry[] = []): MapData => ({
  topic_spaces: topics,
  unassigned_entries: entries,
  updated_at: mapTimestamp,
});
export function mapBackend(
  options: {
    initial?: MapData;
    read?: () => Response | Promise<Response>;
    write?: (path: string, init: RequestInit, data: MapData) => Response | Promise<Response>;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  let data = structuredClone(options.initial || mapData());
  let counter = 0;
  const fetch = mockBackend(options.overrides);
  const original = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname.replace('/api/v1', '');
    if (path === '/users/me/map') return options.read?.() ?? json(data);
    if (!path.startsWith('/users/me/map/')) return original(input, init);
    if (options.write) {
      const response = await options.write(path, init || {}, structuredClone(data));
      if (response.ok) {
        const value = await response.clone().json();
        if (Array.isArray(value.map?.topic_spaces) && Array.isArray(value.map?.unassigned_entries))
          data = structuredClone(value.map);
      }
      return response;
    }
    const payload = init?.body ? JSON.parse(String(init.body)) : {};
    const id = decodeURIComponent(path.split('/')[5] || '');
    if (path === '/users/me/map/topics') {
      const next = topic(`created-${++counter}`, payload.title.trim(), {
        ...payload,
        description: payload.description.trim(),
      });
      data.topic_spaces.push(next);
      return json({ topic: next, map: data });
    }
    if (path.startsWith('/users/me/map/topics/')) {
      const value = data.topic_spaces.find((item) => item.id === id);
      if (!value) return json({ detail: 'Topic space not found' }, 404);
      if (init?.method === 'DELETE') {
        data.unassigned_entries.push(...(value.entries || []));
        data.topic_spaces = data.topic_spaces.filter((item) => item.id !== id);
        data.topic_spaces.forEach((item) => {
          item.related_topic_ids = item.related_topic_ids?.filter((link) => link !== id);
          if (item.parent_topic_id === id) item.parent_topic_id = value.parent_topic_id;
        });
        return json({ deleted: true, topic: value, map: data });
      }
      if (path.endsWith('/merge')) {
        const target = data.topic_spaces.find((item) => item.id === payload.target_topic_space_id)!;
        target.entries!.push(
          ...(value.entries || []),
          mapEntry('preserved-source', value.title, 'merged_topic'),
        );
        data.topic_spaces = data.topic_spaces.filter((item) => item.id !== id);
        return json({ topic: target, map: data });
      }
      if (Object.hasOwn(payload, 'related_topic_ids')) {
        for (const other of data.topic_spaces.filter((item) => item.id !== id)) {
          other.related_topic_ids = (other.related_topic_ids || []).filter((link) => link !== id);
          if (payload.related_topic_ids.includes(other.id)) other.related_topic_ids.push(id);
        }
      }
      Object.assign(value, payload);
      return json({ topic: value, map: data });
    }
    if (path === '/users/me/map/entries') {
      const next = mapEntry(`entry-${++counter}`, payload.text.trim(), payload.category);
      const group = payload.topic_space_id
        ? data.topic_spaces.find((item) => item.id === payload.topic_space_id)!.entries!
        : data.unassigned_entries;
      group.push(next);
      return json({ entry: next, map: data });
    }
    const groups = [
      data.unassigned_entries,
      ...data.topic_spaces.map((item) => item.entries || []),
    ];
    const group = groups.find((items) => items.some((item) => item.id === id));
    const value = group?.find((item) => item.id === id);
    if (!value || !group) return json({ detail: 'Map entry not found' }, 404);
    if (path.includes('/practices/')) {
      Object.assign(value, payload);
      return json({ practice: value, map: data });
    }
    if (init?.method === 'DELETE') {
      group.splice(group.indexOf(value), 1);
      return json({ deleted: true, entry: value, map: data });
    }
    Object.assign(value, { category: payload.category, text: payload.text.trim() });
    if (Object.hasOwn(payload, 'topic_space_id')) {
      group.splice(group.indexOf(value), 1);
      (payload.topic_space_id
        ? data.topic_spaces.find((item) => item.id === payload.topic_space_id)!.entries!
        : data.unassigned_entries
      ).push(value);
    }
    return json({ entry: value, map: data });
  });
  return {
    fetch,
    getData: () => data,
    setData: (value: MapData) => {
      data = value;
    },
    writes: () => fetch.mock.calls.filter((call) => call[1]?.method && call[1].method !== 'GET'),
  };
}

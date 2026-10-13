import { ApiClient, ApiError } from '../../services/apiClient';
import { queueMapWrite } from '../../services/mapResource';
import type {
  MapData,
  MapTopic,
  MapEntry,
  TopicPayload,
  EntryPayload,
  PracticeStatus,
} from '../../types/map';

const base = '/users/me/map';
const idPath = (kind: string, id: string) => `${base}/${kind}/${encodeURIComponent(id)}`;
const invalid = () =>
  new ApiError('The FeelY backend returned invalid Map data. Please try again.', 502);
function validEntry(entry: MapEntry) {
  return (
    entry &&
    typeof entry.id === 'string' &&
    typeof entry.text === 'string' &&
    typeof entry.category === 'string'
  );
}
function strings(value: unknown) {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}
function validTopic(topic: MapTopic) {
  return (
    topic &&
    typeof topic.id === 'string' &&
    typeof topic.title === 'string' &&
    (topic.description === undefined || typeof topic.description === 'string') &&
    strings(topic.chat_ids) &&
    strings(topic.journal_dates) &&
    strings(topic.related_topic_ids) &&
    (topic.parent_topic_id == null || typeof topic.parent_topic_id === 'string') &&
    (topic.entries === undefined ||
      (Array.isArray(topic.entries) && topic.entries.every(validEntry)))
  );
}
export function validateMap(value: MapData): MapData {
  if (
    !value ||
    !Array.isArray(value.topic_spaces) ||
    !value.topic_spaces.every(validTopic) ||
    !Array.isArray(value.unassigned_entries) ||
    !value.unassigned_entries.every(validEntry) ||
    (value.updated_at != null && typeof value.updated_at !== 'string')
  )
    throw invalid();
  if (new Set(value.topic_spaces.map((topic) => topic.id)).size !== value.topic_spaces.length)
    throw invalid();
  return value;
}
export async function loadMap(api: ApiClient, signal?: AbortSignal) {
  return validateMap(await api.request<MapData>(base, { authenticated: true, signal }));
}
export interface MapMutation {
  map: MapData;
  topic?: MapTopic;
  entry?: MapEntry;
  practice?: MapEntry;
  deleted?: boolean;
  commitVersion: number;
}
async function mutate(
  api: ApiClient,
  path: string,
  method: string,
  kind: 'topic' | 'entry' | 'practice',
  payload?: unknown,
  deleting = false,
): Promise<MapMutation> {
  const result = await queueMapWrite(api, async () => {
    const value = await api.request<Omit<MapMutation, 'commitVersion'>>(path, {
      authenticated: true,
      method,
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    validateMap(value?.map);
    if (
      !(kind === 'topic' ? validTopic(value.topic!) : validEntry(value[kind]!)) ||
      (deleting && value.deleted !== true)
    )
      throw invalid();
    const item = value[kind]!;
    let expectedId: string | null = null;
    if (method === 'PATCH' || method === 'DELETE') {
      expectedId = decodeURIComponent(path.split('/').at(-1)!);
    } else if (path.endsWith('/merge')) {
      expectedId = (payload as { target_topic_space_id: string }).target_topic_space_id;
    }
    if (expectedId && item.id !== expectedId) throw invalid();
    const present =
      kind === 'topic'
        ? value.map.topic_spaces.some((topic) => topic.id === item.id)
        : [
            value.map.unassigned_entries,
            ...value.map.topic_spaces.map((topic) => topic.entries || []),
          ].some((entries) => entries.some((entry) => entry.id === item.id));
    if (deleting ? present : !present) throw invalid();
    if (kind === 'practice') {
      const practice = value.practice!;
      const requested = payload as { status: PracticeStatus };
      const mirrored = [
        value.map.unassigned_entries,
        ...value.map.topic_spaces.map((topic) => topic.entries || []),
      ]
        .flat()
        .find((entry) => entry.id === practice.id)!;
      if (
        practice.category !== 'practice' ||
        practice.status !== requested.status ||
        !(practice.reflection === null || typeof practice.reflection === 'string') ||
        mirrored.category !== 'practice' ||
        mirrored.status !== practice.status ||
        mirrored.reflection !== practice.reflection
      )
        throw invalid();
    }
    return value;
  });
  return { ...result.value, commitVersion: result.commitVersion };
}
export const createTopic = (api: ApiClient, payload: TopicPayload) =>
  mutate(api, `${base}/topics`, 'POST', 'topic', payload);
export const updateTopic = (api: ApiClient, id: string, payload: Partial<TopicPayload>) =>
  mutate(api, idPath('topics', id), 'PATCH', 'topic', payload);
export const mergeTopic = (api: ApiClient, id: string, target: string) =>
  mutate(api, `${idPath('topics', id)}/merge`, 'POST', 'topic', { target_topic_space_id: target });
export const deleteTopic = (api: ApiClient, id: string) =>
  mutate(api, idPath('topics', id), 'DELETE', 'topic', undefined, true);
export const createEntry = (api: ApiClient, payload: EntryPayload) =>
  mutate(api, `${base}/entries`, 'POST', 'entry', payload);
export const updateEntry = (api: ApiClient, id: string, payload: EntryPayload) =>
  mutate(api, idPath('entries', id), 'PATCH', 'entry', payload);
export const deleteEntry = (api: ApiClient, id: string) =>
  mutate(api, idPath('entries', id), 'DELETE', 'entry', undefined, true);
export const updatePractice = (
  api: ApiClient,
  id: string,
  status: PracticeStatus,
  reflection: string | null = null,
) => mutate(api, idPath('practices', id), 'PATCH', 'practice', { status, reflection });

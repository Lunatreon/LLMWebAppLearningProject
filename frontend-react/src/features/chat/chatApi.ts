import { ApiClient, ApiError } from '../../services/apiClient';
import { queueMapWrite } from '../../services/mapResource';
import { validateMap } from '../map/mapApi';
import type { MapData } from '../../types/map';
import type {
  Analysis,
  ChatConversation,
  GenerationResult,
  TopicDecision,
  NoteDecision,
  Reaction,
  ChatMessage,
} from './types';
const root = '/llm/chats',
  path = (id: string) => `${root}/${encodeURIComponent(id)}`;
const invalid = () =>
  new ApiError('The FeelY backend returned invalid Chat data. Please try again.', 502);
function messages(value: ChatMessage[]) {
  return (
    Array.isArray(value) &&
    value.every(
      (message) =>
        message &&
        typeof message.role === 'string' &&
        typeof message.content === 'string' &&
        (message.created_at === undefined || typeof message.created_at === 'string'),
    )
  );
}
function validTopic(value: unknown, id: string) {
  const topic = value as { chat_id?: string; topic?: string; description?: string } | null;
  return (
    topic &&
    topic.chat_id === id &&
    typeof topic.topic === 'string' &&
    typeof topic.description === 'string'
  );
}
function validNote(value: unknown, id: string) {
  const note = value as { source_chat_id?: string; text?: string; category?: string } | null;
  return (
    note &&
    (!note.source_chat_id || note.source_chat_id === id) &&
    typeof note.text === 'string' &&
    typeof note.category === 'string'
  );
}
export function conversation(value: ChatConversation, id?: string) {
  if (
    !value ||
    typeof value.chat_id !== 'string' ||
    (id && value.chat_id !== id) ||
    typeof value.title !== 'string' ||
    typeof value.message_count !== 'number' ||
    !messages(value.messages)
  )
    throw invalid();
  if (
    (value.pending_topic && !validTopic(value.pending_topic, value.chat_id)) ||
    (value.pending_topics &&
      (!Array.isArray(value.pending_topics) ||
        !value.pending_topics.every((topic) => validTopic(topic, value.chat_id)))) ||
    (value.pending_map_suggestion && !validNote(value.pending_map_suggestion, value.chat_id))
  )
    throw invalid();
  return value;
}
export async function loadConversationPage(api: ApiClient, signal?: AbortSignal, cursor?: string) {
  const query = new URLSearchParams({ paginated: 'true' });
  if (cursor) query.set('cursor', cursor);
  const value = await api.request<
    ChatConversation[] | { items: ChatConversation[]; next_cursor: string | null }
  >(`${root}?${query}`, { authenticated: true, signal });
  // Retain compatibility with older servers during a rolling frontend upgrade.
  const page = Array.isArray(value) ? { items: value, next_cursor: null } : value;
  if (
    !page ||
    !Array.isArray(page.items) ||
    (page.next_cursor !== null && typeof page.next_cursor !== 'string')
  )
    throw invalid();
  page.items.forEach((chat) => conversation(chat));
  if (new Set(page.items.map((chat) => chat.chat_id)).size !== page.items.length) throw invalid();
  return page;
}
export async function loadConversations(api: ApiClient, signal?: AbortSignal) {
  return (await loadConversationPage(api, signal)).items;
}
export async function loadConversation(
  api: ApiClient,
  id: string,
  signal?: AbortSignal,
  before?: number,
) {
  return conversation(
    await api.request<ChatConversation>(
      `${path(id)}${before === undefined ? '' : `?before_position=${before}`}`,
      { authenticated: true, signal },
    ),
    id,
  );
}
export async function createConversation(api: ApiClient, signal: AbortSignal) {
  return conversation(
    await api.request<ChatConversation>(root, {
      method: 'POST',
      authenticated: true,
      body: '{}',
      signal,
    }),
  );
}
export const deleteConversation = (api: ApiClient, id: string) =>
  api.request<null>(path(id), { method: 'DELETE', authenticated: true });
export async function generate(
  api: ApiClient,
  id: string,
  context: string,
  signal: AbortSignal,
  delta: (text: string) => void,
) {
  let result: GenerationResult | null = null;
  await api.stream(
    '/llm/message/stream',
    { authenticated: true, method: 'POST', body: JSON.stringify({ chat_id: id, context }), signal },
    (value) => {
      const event = value as {
        type?: string;
        text?: unknown;
        data?: GenerationResult;
        message?: string;
        status?: number;
      } | null;
      if (!event || typeof event.type !== 'string') throw invalid();
      if (event.type === 'text_delta') {
        if (typeof event.text !== 'string' || result) throw invalid();
        delta(event.text);
      } else if (event.type === 'result') {
        const data = event.data;
        if (
          result ||
          !data ||
          data.chat_id !== id ||
          typeof data.assistant_message !== 'string' ||
          !messages(data.chat_info?.messages) ||
          (data.chat_info.chat_id !== undefined && data.chat_info.chat_id !== id)
        )
          throw invalid();
        const exchange =
          data.turn_id === undefined
            ? data.chat_info.messages.slice(-2)
            : data.chat_info.messages.filter((message) => message.turn_id === data.turn_id);
        if (
          exchange[0]?.role !== 'user' ||
          exchange[0].content !== context ||
          exchange[1]?.role !== 'assistant' ||
          exchange[1].content !== data.assistant_message
        )
          throw invalid();
        conversation({ ...data.chat_info, chat_id: id }, id);
        result = data;
      } else if (event.type === 'error')
        throw new ApiError(event.message || 'Request failed', event.status || 500);
      else if (event.type !== 'status') throw invalid();
    },
  );
  if (!result) throw new ApiError('The response stream ended unexpectedly. Please retry.', 502);
  return result as GenerationResult;
}
export function resultConversation(result: GenerationResult): ChatConversation {
  return conversation({
    ...result.chat_info,
    chat_id: result.chat_id,
    pending_map_suggestion: result.map_suggestion || null,
  });
}
export async function loadAnalysis(api: ApiClient, id: string, signal?: AbortSignal) {
  const value = await api.request<Analysis>(`${path(id)}/topic-suggestion`, {
    authenticated: true,
    signal,
  });
  if (
    !value ||
    typeof value.analysis_status !== 'string' ||
    (value.suggestions !== undefined && !Array.isArray(value.suggestions))
  )
    throw invalid();
  for (const suggestion of [
    ...(value.suggestions || []),
    ...(value.suggestion ? [value.suggestion] : []),
  ])
    if (!validTopic(suggestion, id)) throw invalid();
  if (value.map_suggestion && !validNote(value.map_suggestion, id)) throw invalid();
  return value;
}
export const retryAnalysis = (api: ApiClient, id: string) =>
  api.request<{ analysis_status: string }>(`${path(id)}/topic-suggestion/retry`, {
    authenticated: true,
    method: 'POST',
  });
export async function react(
  api: ApiClient,
  id: string,
  created_at: string,
  reaction: Reaction,
  turn_id?: number,
) {
  const value = await api.request<{ reaction: Reaction }>(`${path(id)}/reaction`, {
    method: 'PUT',
    authenticated: true,
    body: JSON.stringify({ created_at, reaction, ...(turn_id ? { turn_id } : {}) }),
  });
  if (!value || ![null, 'like', 'dislike'].includes(value.reaction)) throw invalid();
  return value.reaction;
}
export async function decideTopic(api: ApiClient, payload: TopicDecision) {
  const result = await queueMapWrite(api, async () => {
    const value = await api.request<{
      accepted: boolean;
      profile: { self_authorship_map?: MapData };
      saved_topic_space_id?: string | null;
    }>('/llm/topics/confirm', {
      method: 'POST',
      authenticated: true,
      body: JSON.stringify(payload),
    });
    if (!value || value.accepted !== payload.accepted || !value.profile) throw invalid();
    if (value.profile.self_authorship_map) validateMap(value.profile.self_authorship_map);
    return value;
  });
  return { ...result.value, commitVersion: result.commitVersion };
}
export async function decideNote(api: ApiClient, payload: NoteDecision) {
  const result = await queueMapWrite(api, async () => {
    const value = await api.request<{ accepted: boolean; map: MapData }>(
      '/llm/map-suggestions/confirm',
      { method: 'POST', authenticated: true, body: JSON.stringify(payload) },
    );
    if (!value || value.accepted !== payload.accepted) throw invalid();
    validateMap(value.map);
    return value;
  });
  return { ...result.value, commitVersion: result.commitVersion };
}

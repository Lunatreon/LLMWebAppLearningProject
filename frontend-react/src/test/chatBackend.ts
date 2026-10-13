import { mockBackend, json } from './backend';
import type {
  ChatConversation as Conversation,
  TopicSuggestion,
  MapSuggestion,
  GenerationResult,
} from '../features/chat/types';
import { mapData, topic, mapEntry } from './mapBackend';
export function chat(id: string, title = `Conversation ${id}`, text = ''): Conversation {
  return {
    chat_id: id,
    title,
    message_count: text ? 1 : 0,
    updated_at: '2026-10-12T12:00:00Z',
    pending_topic: null,
    pending_topics: [],
    pending_map_suggestion: null,
    messages: text
      ? [
          { role: 'user', content: text, created_at: '2026-10-12T12:00:00Z' },
          { role: 'assistant', content: `Reply to ${text}`, created_at: '2026-10-12T12:00:00Z' },
        ]
      : [],
  };
}
export const detectedTopic = (id: string): TopicSuggestion => ({
  chat_id: id,
  topic: 'Family',
  description: 'A possible thread',
  category: 'person',
  related_topic_ids: [],
  suggestion_id: `suggestion-${id}`,
  queue_position: 1,
  queue_total: 1,
  confidence: 0.9,
  matched_patterns: [],
  status: 'pending',
});
export const detectedNote = (id: string): MapSuggestion => ({
  source_chat_id: id,
  category: 'value',
  text: 'Honesty matters',
  reason: 'A recurring value',
  topic_space_id: null,
  topic_title: null,
});
export function generation(
  chat: Conversation,
  context = 'Hello',
  response = 'A complete reply',
): GenerationResult {
  return {
    chat_id: chat.chat_id,
    assistant_message: response,
    chat_info: {
      ...chat,
      message_count: chat.message_count + 1,
      messages: [
        ...chat.messages,
        { role: 'user', content: context, created_at: '2026-10-12T12:01:00Z' },
        { role: 'assistant', content: response, created_at: '2026-10-12T12:01:00Z' },
      ],
    },
    map_suggestion: null,
    topic_analysis_status: 'queued',
  };
}
export function streamResponse(events: unknown[], finalNewline = true) {
  return new Response(
    events.map((event) => JSON.stringify(event)).join('\n') + (finalNewline ? '\n' : ''),
    { headers: { 'Content-Type': 'application/x-ndjson' } },
  );
}
export function controlledStream(signal?: AbortSignal) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
      cancel() {},
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } },
  );
  signal?.addEventListener(
    'abort',
    () => {
      try {
        stream.error(new DOMException('Aborted', 'AbortError'));
      } catch {
        /* Already ended. */
      }
    },
    { once: true },
  );
  return {
    response,
    event: (event: unknown) => stream.enqueue(encoder.encode(JSON.stringify(event) + '\n')),
    bytes: (bytes: Uint8Array) => stream.enqueue(bytes),
    close: () => stream.close(),
    fail: () => stream.error(new TypeError('Offline')),
  };
}
export function chatBackend(
  options: {
    initial?: Conversation[];
    list?: () => Response | Promise<Response>;
    read?: (id: string) => Response | Promise<Response>;
    stream?: (id: string, text: string, init: RequestInit) => Response | Promise<Response>;
    analysis?: (id: string) => Response | Promise<Response>;
    action?: (path: string, init: RequestInit) => Response | Promise<Response>;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  let records = structuredClone(options.initial || []);
  let map = mapData();
  let count = 0;
  const fetch = mockBackend(options.overrides),
    original = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname.replace('/api/v1', '');
    const method = init?.method || 'GET';
    if (options.overrides?.[path]) return options.overrides[path]();
    if (path === '/users/me/map') return json(map);
    if (path === '/llm/chats') {
      if (method === 'POST') {
        const value = chat(`created-${++count}`, 'New chat');
        records.unshift(value);
        return json(value, 201);
      }
      return options.list?.() ?? json(records);
    }
    if (path === '/llm/message/stream') {
      const payload = JSON.parse(String(init?.body));
      if (options.stream) return options.stream(payload.chat_id, payload.context, init!);
      const value = records.find((chat) => chat.chat_id === payload.chat_id)!;
      const result = generation(value, payload.context);
      records = records.map((chat) =>
        chat.chat_id === payload.chat_id ? { ...result.chat_info, chat_id: payload.chat_id } : chat,
      );
      return streamResponse([
        { type: 'status', message: 'Connected to FeelY' },
        { type: 'text_delta', text: result.assistant_message },
        { type: 'result', data: result },
      ]);
    }
    if (path.startsWith('/llm/chats/')) {
      const id = decodeURIComponent(path.split('/')[3]);
      const value = records.find((chat) => chat.chat_id === id);
      if (method !== 'GET' && options.action) return options.action(path, init!);
      if (path.endsWith('/topic-suggestion/retry')) return json({ analysis_status: 'queued' }, 202);
      if (path.endsWith('/topic-suggestion'))
        return (
          options.analysis?.(id) ??
          json({
            suggestion: value?.pending_topic || null,
            suggestions: value?.pending_topics || [],
            map_suggestion: value?.pending_map_suggestion || null,
            chat_title: value?.title || 'New chat',
            analysis_status: value?.analysis_status || 'idle',
          })
        );
      if (method === 'DELETE') {
        if (!value) return json({ detail: 'Chat not found' }, 404);
        records = records.filter((chat) => chat.chat_id !== id);
        return new Response(null, { status: 204 });
      }
      if (path.endsWith('/reaction'))
        return json({ reaction: JSON.parse(String(init?.body)).reaction });
      return options.read?.(id) ?? (value ? json(value) : json({ detail: 'Chat not found' }, 404));
    }
    if (path === '/llm/topics/confirm' || path === '/llm/map-suggestions/confirm') {
      if (options.action) return options.action(path, init!);
      const payload = JSON.parse(String(init?.body)),
        value = records.find((chat) => chat.chat_id === payload.chat_id)!;
      if (path === '/llm/topics/confirm') {
        value.pending_topic = null;
        value.pending_topics = [];
        if (payload.accepted)
          map.topic_spaces.push(
            topic('saved-topic', payload.topic, {
              category: payload.category,
              description: payload.description,
              chat_ids: [value.chat_id],
            }),
          );
        return json({
          accepted: payload.accepted,
          profile: { self_authorship_map: map },
          saved_topic_space_id: payload.accepted ? 'saved-topic' : null,
        });
      }
      value.pending_map_suggestion = null;
      if (payload.accepted)
        map.unassigned_entries.push(
          mapEntry('saved-note', payload.text, payload.category, {
            source_chat_id: payload.chat_id,
          }),
        );
      return json({
        accepted: payload.accepted,
        entry: payload.accepted ? map.unassigned_entries.at(-1) : null,
        map,
      });
    }
    return original(input, init);
  });
  return {
    fetch,
    setRecords: (value: Conversation[]) => {
      records = value;
    },
    setMap: (value: typeof map) => {
      map = value;
    },
    records: () => records,
    writes: () => fetch.mock.calls.filter((call) => call[1]?.method && call[1].method !== 'GET'),
  };
}

import { mockBackend, json } from './backend';
import { journalWordTotal } from '../features/journal/dates';
import type { JournalEntry, JournalSuggestion } from '../features/journal/types';

export function entry(
  date: string,
  content = '',
  saved = Boolean(content),
  suggestions: JournalSuggestion[] = [],
): JournalEntry {
  return {
    entry_date: date,
    content,
    word_count: journalWordTotal(content),
    suggestions,
    analysis_stale: false,
    analysed_at: null,
    created_at: saved ? '2026-10-12T10:00:00Z' : null,
    updated_at: saved ? '2026-10-12T10:00:00Z' : null,
  };
}
export const topicSuggestion: JournalSuggestion = {
  id: 'topic-1',
  kind: 'topic',
  category: 'topic',
  topic_category: 'other',
  title: 'A possible topic',
  text: 'Original topic description',
  reason: 'A recurring theme',
  status: 'pending',
  created_at: '2026-10-12T10:00:00Z',
  saved_item_id: null,
};
export const mapSuggestion: JournalSuggestion = {
  ...topicSuggestion,
  id: 'entry-1',
  kind: 'map_entry',
  category: 'value',
  title: '',
  text: 'A possible value',
};
export function journalBackend(
  options: {
    initial?: Record<string, JournalEntry>;
    read?: (date: string) => Response | Promise<Response>;
    write?: (date: string, text: string, options: RequestInit) => Response | Promise<Response>;
    history?: () => Response | Promise<Response>;
    analyse?: (date: string) => Response | Promise<Response>;
    decide?: (
      date: string,
      id: string,
      payload: Record<string, unknown>,
    ) => Response | Promise<Response>;
    topics?: () => Response | Promise<Response>;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  const stored = new Map(Object.entries(options.initial ?? {}));
  const fetch = mockBackend(options.overrides);
  const original = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/journal/entries')
      return (
        options.history?.() ??
        json(
          [...stored.values()]
            .filter((value) => value.updated_at)
            .map((value) => ({
              entry_date: value.entry_date,
              excerpt: value.content,
              word_count: value.word_count,
              suggestion_count: value.suggestions.length,
              updated_at: value.updated_at,
            }))
            .sort((a, b) => b.entry_date.localeCompare(a.entry_date)),
        )
      );
    const match = path.match(
      /^\/journal\/entries\/(\d{4}-\d{2}-\d{2})(?:\/(analyse|suggestions)\/?([^/]*)?)?$/,
    );
    if (match) {
      const date = match[1];
      if (match[2] === 'analyse')
        return (
          options.analyse?.(date) ??
          json({
            entry: entry(date, stored.get(date)?.content, true, [topicSuggestion, mapSuggestion]),
          })
        );
      if (match[2] === 'suggestions')
        return (
          options.decide?.(date, match[3], JSON.parse(String(init?.body))) ??
          json({
            suggestion: {
              ...(match[3] === 'topic-1' ? topicSuggestion : mapSuggestion),
              status: JSON.parse(String(init?.body)).accepted ? 'saved' : 'dismissed',
              saved_item_id: 'saved-1',
            },
            map: {
              topic_spaces: [{ id: 'saved-1', title: 'Saved topic', category: 'experience' }],
            },
          })
        );
      if (init?.method === 'PUT') {
        const text = JSON.parse(String(init.body)).content;
        if (options.write) return options.write(date, text, init);
        const saved = entry(date, text, true, stored.get(date)?.suggestions);
        stored.set(date, saved);
        return json(saved);
      }
      return options.read?.(date) ?? json(stored.get(date) ?? entry(date));
    }
    if (path === '/users/me/map')
      return (
        options.topics?.() ??
        json({ topic_spaces: [{ id: 'existing', title: 'Existing topic', category: 'person' }] })
      );
    return original(input, init);
  });
  const puts = () => fetch.mock.calls.filter((call) => call[1]?.method === 'PUT');
  const posts = () => fetch.mock.calls.filter((call) => call[1]?.method === 'POST');
  return { fetch, stored, puts, posts };
}

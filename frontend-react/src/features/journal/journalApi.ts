import { ApiClient, ApiError } from '../../services/apiClient';
import { queueMapWrite } from '../../services/mapResource';
import { validDateKey } from './dates';
import type {
  JournalEntry,
  JournalHistoryItem,
  JournalMap,
  JournalSuggestion,
  SuggestionDecision,
} from './types';

function invalid() {
  return new ApiError('The FeelY backend returned invalid Journal data. Please try again.', 502);
}
function validSuggestion(value: JournalSuggestion) {
  return (
    value &&
    typeof value.id === 'string' &&
    ['topic', 'map_entry'].includes(value.kind) &&
    typeof value.text === 'string' &&
    typeof value.title === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.category === 'string' &&
    ['person', 'trait', 'experience', 'other'].includes(value.topic_category) &&
    typeof value.created_at === 'string' &&
    (value.saved_item_id === null || typeof value.saved_item_id === 'string') &&
    ['pending', 'saved', 'dismissed'].includes(value.status)
  );
}
function entry(value: JournalEntry, date: string) {
  if (
    !value ||
    value.entry_date !== date ||
    typeof value.content !== 'string' ||
    typeof value.word_count !== 'number' ||
    !Array.isArray(value.suggestions) ||
    !value.suggestions.every(validSuggestion) ||
    typeof value.analysis_stale !== 'boolean' ||
    ![value.analysed_at, value.created_at, value.updated_at].every(
      (timestamp) => timestamp === null || typeof timestamp === 'string',
    )
  )
    throw invalid();
  return value;
}
function path(date: string) {
  if (!validDateKey(date)) throw new ApiError('Journal date must use YYYY-MM-DD.', 422);
  return `/journal/entries/${encodeURIComponent(date)}`;
}
export async function loadJournalHistory(api: ApiClient, signal?: AbortSignal) {
  const value = await api.request<JournalHistoryItem[]>('/journal/entries?limit=180', {
    authenticated: true,
    signal,
  });
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        validDateKey(item.entry_date) &&
        typeof item.excerpt === 'string' &&
        typeof item.word_count === 'number' &&
        typeof item.suggestion_count === 'number' &&
        typeof item.updated_at === 'string',
    )
  )
    throw invalid();
  return value;
}
export async function loadJournalEntry(api: ApiClient, date: string, signal?: AbortSignal) {
  return entry(await api.request<JournalEntry>(path(date), { authenticated: true, signal }), date);
}
export async function saveJournalEntry(
  api: ApiClient,
  date: string,
  content: string,
  keepalive = false,
) {
  return entry(
    await api.request<JournalEntry>(path(date), {
      authenticated: true,
      method: 'PUT',
      body: JSON.stringify({ content }),
      ...(keepalive ? { keepalive: true } : {}),
    }),
    date,
  );
}
export async function analyseJournalEntry(api: ApiClient, date: string) {
  const value = await api.request<{ entry: JournalEntry }>(`${path(date)}/analyse`, {
    authenticated: true,
    method: 'POST',
  });
  return entry(value?.entry, date);
}
export async function loadJournalTopics(api: ApiClient) {
  const value = await api.request<JournalMap>('/users/me/map', { authenticated: true });
  if (
    !Array.isArray(value?.topic_spaces) ||
    !value.topic_spaces.every(
      (topic) => typeof topic.id === 'string' && typeof topic.title === 'string',
    )
  )
    throw invalid();
  return value.topic_spaces;
}
export async function decideJournalSuggestion(
  api: ApiClient,
  date: string,
  id: string,
  payload: SuggestionDecision,
) {
  const result = await queueMapWrite(api, async () => {
    const value = await api.request<{ suggestion: JournalSuggestion; map: JournalMap }>(
      `${path(date)}/suggestions/${encodeURIComponent(id)}`,
      { authenticated: true, method: 'POST', body: JSON.stringify(payload) },
    );
    if (
      !validSuggestion(value?.suggestion) ||
      value.suggestion.id !== id ||
      !Array.isArray(value.map?.topic_spaces) ||
      !value.map.topic_spaces.every(
        (topic) => typeof topic.id === 'string' && typeof topic.title === 'string',
      )
    )
      throw invalid();
    return value;
  });
  return result.value;
}

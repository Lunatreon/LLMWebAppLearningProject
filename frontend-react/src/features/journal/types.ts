import type { TopicCategory, MapTopicChoice } from '../../types/map';
export { entryCategories, categoryLabels, topicCategories } from '../../types/map';
export type { TopicCategory } from '../../types/map';
export interface JournalSuggestion {
  id: string;
  kind: 'topic' | 'map_entry';
  category: string;
  topic_category: TopicCategory;
  title: string;
  text: string;
  reason: string;
  status: 'pending' | 'saved' | 'dismissed';
  created_at: string;
  saved_item_id: string | null;
}
export interface JournalEntry {
  entry_date: string;
  content: string;
  word_count: number;
  suggestions: JournalSuggestion[];
  analysis_stale: boolean;
  analysed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}
export interface JournalHistoryItem {
  entry_date: string;
  excerpt: string;
  word_count: number;
  suggestion_count: number;
  updated_at: string;
}
export type JournalTopic = MapTopicChoice;
export { topicCategoryOf as journalTopicCategory } from '../../types/map';
export interface JournalMap {
  topic_spaces: JournalTopic[];
  unassigned_entries?: unknown[];
  updated_at?: string | null;
}
export interface SuggestionDecision {
  accepted: boolean;
  title?: string | null;
  text?: string;
  category?: string | null;
  topic_category?: TopicCategory | null;
  topic_space_id?: string | null;
}
export interface JournalDraft {
  entry: JournalEntry | null;
  text: string;
  baseline: string;
  loading: boolean;
  loadError: string;
  status: 'saved' | 'saving' | 'error';
  message: string;
  saving: boolean;
  revision: number;
  inflightText: string | null;
  editRevision: number;
  editedAt: number;
  errorStatus: number | null;
}
export interface JournalSnapshot {
  selected: string;
  draft: JournalDraft;
  dirty: boolean;
  enabled: boolean;
  denied: boolean;
  history: JournalHistoryItem[];
  historyLoading: boolean;
  historyError: string;
  topics: JournalTopic[];
  topicsError: string;
  analysing: boolean;
  deciding: string[];
}

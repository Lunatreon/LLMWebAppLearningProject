// Shared backend DTOs; graph coordinates and selection are separate UI state.
export type TopicCategory = 'person' | 'trait' | 'experience' | 'other';
export const topicCategories = {
  person: 'Person',
  trait: 'Trait',
  experience: 'Experience',
  other: 'Other',
};
export const entryCategories = {
  inherited_script: 'Inherited script',
  own_perception: 'My perception',
  value: 'Value',
  body_signal: 'Body signal',
  practice: 'Practice',
  evidence: 'Evidence',
};
export const categoryLabels = { ...entryCategories, merged_topic: 'Merged topic' };
export type EntryCategory = keyof typeof categoryLabels;
export type PracticeStatus = 'active' | 'paused' | 'completed';
export interface MapTopicChoice {
  id: string;
  title: string;
  category?: TopicCategory;
}
export interface MapEntry {
  id: string;
  category: EntryCategory;
  text: string;
  source_chat_id?: string | null;
  source_journal_date?: string | null;
  reason?: string | null;
  created_at?: string;
  updated_at?: string;
  status?: PracticeStatus;
  reflection?: string | null;
  source_topic_id?: string;
  source_topic_title?: string;
}
export interface MapTopic extends MapTopicChoice {
  description?: string;
  parent_topic_id?: string | null;
  related_topic_ids?: string[];
  chat_ids?: string[];
  journal_dates?: string[];
  entries?: MapEntry[];
  created_at?: string;
  updated_at?: string;
}
export interface MapData {
  topic_spaces: MapTopic[];
  unassigned_entries: MapEntry[];
  updated_at?: string | null;
}
export interface TopicPayload {
  title: string;
  category: TopicCategory;
  description: string;
  parent_topic_id: string | null;
  related_topic_ids: string[];
  chat_id?: string | null;
}
export interface EntryPayload {
  category: EntryCategory;
  text: string;
  topic_space_id: string | null;
  source_chat_id?: string | null;
}
export function topicCategoryOf(topic: MapTopicChoice): TopicCategory {
  return Object.hasOwn(topicCategories, topic.category || '') ? topic.category! : 'other';
}

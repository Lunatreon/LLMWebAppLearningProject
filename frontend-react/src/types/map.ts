// Shared backend DTOs; graph coordinates and selection are separate UI state.
export type TopicCategory = string;
export const topicCategories: Record<string, string> = {
  person: 'Person',
  trait: 'Trait',
  experience: 'Experience',
  other: 'Other',
};
export const entryCategories: Record<string, string> = {
  inherited_script: 'Inherited script',
  own_perception: 'My perception',
  value: 'Value',
  body_signal: 'Body signal',
  practice: 'Practice',
  evidence: 'Evidence',
  task: 'Task',
};
export const categoryLabels: Record<string, string> = {
  ...entryCategories,
  merged_topic: 'Merged topic',
};
export type EntryCategory = string;
export type PracticeStatus = 'active' | 'paused' | 'completed';
export interface MapTopicChoice {
  id: string;
  title: string;
  category?: TopicCategory;
}
export interface MapCategory {
  kind: 'topic' | 'entry';
  key: string;
  label: string;
  description: string;
  active: boolean;
  llm_enabled: boolean;
  supports_completion: boolean;
}
export interface MapEntry {
  working_on?: boolean;
  completion_percent?: number | null;
  id: string;
  category: EntryCategory;
  text: string;
  source_chat_id?: string | null;
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
  entries?: MapEntry[];
  created_at?: string;
  updated_at?: string;
}
export interface MapData {
  revision?: number;
  categories?: MapCategory[];
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
  working_on?: boolean;
  completion_percent?: number | null;
  category: EntryCategory;
  text: string;
  topic_space_id: string | null;
  source_chat_id?: string | null;
}
export function topicCategoryOf(topic: MapTopicChoice): TopicCategory {
  return topic.category || 'other';
}

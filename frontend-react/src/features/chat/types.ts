import type { TopicCategory, EntryCategory } from '../../types/map';
export type Reaction = 'like' | 'dislike' | null;
export interface ChatMessage {
  role: string;
  content: string;
  created_at?: string;
  reaction?: Reaction;
}
export interface TopicSuggestion {
  chat_id: string;
  topic: string;
  description: string;
  category?: TopicCategory;
  related_topic_ids?: string[];
  confidence?: number;
  matched_patterns?: string[];
  status?: string;
  existing_topic_id?: string | null;
  parent_topic_id?: string | null;
  suggestion_id?: string | null;
  queue_position?: number;
  queue_total?: number;
}
export interface MapSuggestion {
  category: EntryCategory;
  text: string;
  reason?: string | null;
  source_chat_id?: string;
  topic_space_id?: string | null;
  topic_title?: string | null;
}
export interface ChatConversation {
  chat_id: string;
  title: string;
  message_count: number;
  updated_at?: string | null;
  messages: ChatMessage[];
  pending_topic?: TopicSuggestion | null;
  pending_topics?: TopicSuggestion[];
  pending_map_suggestion?: MapSuggestion | null;
  analysis_status?: string;
}
export interface GenerationResult {
  chat_id: string;
  assistant_message: string;
  chat_info: Omit<ChatConversation, 'chat_id'> & { chat_id?: string };
  map_suggestion?: MapSuggestion | null;
  topic_analysis_status?: string;
}
export interface Analysis {
  suggestion?: TopicSuggestion | null;
  suggestions?: TopicSuggestion[];
  map_suggestion?: MapSuggestion | null;
  analysis_status: string;
  chat_title?: string | null;
}
export interface TopicDecision {
  chat_id: string;
  require_map_access: true;
  suggestion_id: string | null;
  entry_category: EntryCategory;
  topic: string;
  description: string;
  category: TopicCategory;
  related_topic_ids: string[];
  accepted: boolean;
  existing_topic_space_id: string | null;
  parent_topic_space_id: string | null;
}
export interface NoteDecision {
  chat_id: string;
  accepted: boolean;
  category: EntryCategory;
  text: string;
  reason?: string | null;
  topic_space_id?: string | null;
}
export interface GenerationView {
  id: number;
  chatId: string | null;
  context: string;
  text: string;
  shown: string;
  chunks: string[];
}
export interface ChatSnapshot {
  enabled: boolean;
  mapAccess: boolean;
  active: string | null;
  chats: ChatConversation[];
  draft: string;
  loading: boolean;
  listLoading: boolean;
  listError: string;
  error: string;
  errorStatus: number | null;
  generation: GenerationView | null;
  review: 'topic' | 'note' | null;
  reviewPending: boolean;
  analysisStatus: string;
  retryPending: boolean;
  retryError: boolean;
  menu: string | null;
  deleting: string | null;
  confirmation: string | null;
  reactionPending: string[];
  focusVersion: number;
  scrollVersion: number;
  preflight: boolean;
}
export const emptyPrompts = [
  'A feeling I cannot place',
  'Something I keep thinking about',
  'A decision I am facing',
];
export const lenses = [
  {
    name: 'Data',
    label: 'What happened?',
    text: 'What actually happened, and what evidence do I have?',
  },
  {
    name: 'Body',
    label: 'What do I sense?',
    text: 'What do I notice in my body as I think about this?',
  },
  {
    name: 'Imagination',
    label: 'What else is possible?',
    text: 'If I trusted my own perception, what response becomes possible?',
  },
];

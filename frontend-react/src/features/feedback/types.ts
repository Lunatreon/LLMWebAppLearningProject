export type FeedbackCategory = 'general' | 'bug' | 'idea';
export interface FeedbackPayload {
  category: FeedbackCategory;
  message: string;
}
export interface FeedbackResponse {
  id: number;
  detail: string;
}

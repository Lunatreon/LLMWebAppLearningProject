import { ApiClient } from '../../services/apiClient';
import type { FeedbackPayload, FeedbackResponse } from './types';

export function submitFeedback(api: ApiClient, payload: FeedbackPayload) {
  return api.request<FeedbackResponse>('/feedback', {
    authenticated: true,
    method: 'POST',
    body: JSON.stringify({ category: payload.category, message: payload.message.trim() }),
  });
}

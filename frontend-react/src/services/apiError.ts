export const sessionEndedMessage = 'Your session has ended. Please sign in again.';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

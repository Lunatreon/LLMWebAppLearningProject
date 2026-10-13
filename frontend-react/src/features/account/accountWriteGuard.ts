import { ApiClient, ApiError } from '../../services/apiClient';

const writes = new WeakMap<ApiClient, Map<string, 'profile' | 'password'>>();
export function beginAccountWrite(api: ApiClient, token: string, kind: 'profile' | 'password') {
  const pending = writes.get(api) ?? new Map();
  writes.set(api, pending);
  const existing = pending.get(token);
  if (existing)
    throw new ApiError(
      existing === 'profile'
        ? 'A profile save is already in progress. Please wait before trying again.'
        : 'A password change is already in progress. Please wait before trying again.',
      409,
    );
  pending.set(token, kind);
  return () => pending.delete(token);
}

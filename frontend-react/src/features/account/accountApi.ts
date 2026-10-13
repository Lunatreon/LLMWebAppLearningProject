import { ApiClient, ApiError } from '../../services/apiClient';
import type { AccountResponse } from '../../types/api';
import type { ProfileUpdate } from './types';
import { beginAccountWrite } from './accountWriteGuard';

// A routed form can be closed/reopened while a write is pending. Serialize saves
// for that client/session without creating another global account data model.

export async function updateProfile(api: ApiClient, payload: ProfileUpdate, requestToken: string) {
  const release = beginAccountWrite(api, requestToken, 'profile');
  try {
    const account = await api.request<AccountResponse>('/users/me/account', {
      authenticated: true,
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (!account?.id || typeof account.email !== 'string' || typeof account.username !== 'string') {
      throw new ApiError('The FeelY backend returned an invalid account response.', 502);
    }
    return account;
  } finally {
    release();
  }
}

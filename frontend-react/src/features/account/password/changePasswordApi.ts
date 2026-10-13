import { ApiClient, ApiError } from '../../../services/apiClient';
import { beginAccountWrite } from '../accountWriteGuard';
import type { AccountResponse, ChangePasswordPayload } from './types';

export async function changePassword(
  api: ApiClient,
  payload: ChangePasswordPayload,
  token: string,
) {
  const release = beginAccountWrite(api, token, 'password');
  try {
    const account = await api.request<AccountResponse>('/users/me/password', {
      authenticated: true,
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (
      !account?.id ||
      typeof account.email !== 'string' ||
      typeof account.username !== 'string' ||
      typeof account.has_password !== 'boolean' ||
      typeof account.auth_provider !== 'string'
    ) {
      throw new ApiError('The FeelY backend returned an invalid password-change response.', 502);
    }
    return account;
  } finally {
    release();
  }
}

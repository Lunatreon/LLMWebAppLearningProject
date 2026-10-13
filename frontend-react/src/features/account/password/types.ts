export interface ChangePasswordPayload {
  current_password: string | null;
  new_password: string;
}
export type { AccountResponse } from '../../../types/api';

import { featureFromPath, loginReturnPath, workspaceFromRoute } from '../../utils/routes';
import { resetSuccessMessage } from './recovery/resetLink';
import { reflectionPracticeId } from '../reflection/types';

export interface AuthHandoffState {
  email?: string;
  notice?: 'registered' | 'activated' | 'verification-required' | 'password-reset';
  afterLogin: string;
  workspace: 'chat' | 'map' | 'journal';
}
export function authDestinationState(state: unknown, search: string) {
  const afterLogin = loginReturnPath(state, search);
  return {
    afterLogin,
    workspace: workspaceFromRoute(featureFromPath(afterLogin), state),
    ...(afterLogin === '/reflection' && reflectionPracticeId(state)
      ? { practiceId: reflectionPracticeId(state), reflectionResume: true }
      : {}),
  };
}
export function handoffEmail(state: unknown) {
  const value = state && typeof state === 'object' ? (state as AuthHandoffState).email : undefined;
  return typeof value === 'string' && value.length <= 320 && value.includes('@')
    ? value.trim()
    : '';
}
export function handoffNotice(state: unknown) {
  const value = state && typeof state === 'object' ? (state as AuthHandoffState).notice : undefined;
  switch (value) {
    case 'registered':
      return 'We sent your activation PIN. Check your inbox and spam folder.';
    case 'activated':
      return 'Email activated. You can now log in.';
    case 'verification-required':
      return 'Enter your PIN or request a new one to activate your account.';
    case 'password-reset':
      return resetSuccessMessage;
    default:
      return '';
  }
}

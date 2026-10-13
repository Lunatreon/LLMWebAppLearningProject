import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../../hooks/useSession';
import { ApiError } from '../../../services/apiClient';
import { hasMinimumPasswordLength } from '../../../utils/passwordValidation';
import { changePassword } from './changePasswordApi';
import type { AccountResponse } from './types';

export function useChangePassword(account: AccountResponse, token: string) {
  const { controller } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const alive = useRef(false);
  const request = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!account.has_password) setCurrentPassword('');
  }, [account.has_password]);

  async function submit() {
    if (
      request.current ||
      controller.getToken() !== token ||
      controller.getSnapshot().session.status !== 'authenticated'
    )
      return;
    setFailed(false);
    if (!newPassword.trim()) {
      setFailed(true);
      setMessage('Enter a new password.');
      return;
    }
    if (!hasMinimumPasswordLength(newPassword) || (account.has_password && !currentPassword))
      return;
    if (newPassword !== confirmation) {
      setFailed(true);
      setMessage('The passwords do not match.');
      return;
    }
    request.current = true;
    setPending(true);
    setMessage('Updating password...');
    try {
      const result = await changePassword(
        controller.api,
        { current_password: currentPassword || null, new_password: newPassword },
        token,
      );
      if (controller.getToken() !== token) return;
      if (result.id !== account.id)
        throw new ApiError('The FeelY backend returned an account for a different session.', 502);
      if (alive.current) {
        // The successful mutation consumed these local credentials, even if a
        // concurrent session read subsequently needs recovery.
        setCurrentPassword('');
        setNewPassword('');
        setConfirmation('');
        setMessage('Password updated.');
      }
      if (!controller.applyAccountResponse(result, token)) await controller.reload({ force: true });
    } catch (error) {
      if (alive.current && controller.getToken() === token) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : 'Request failed');
      }
    } finally {
      request.current = false;
      if (alive.current && controller.getToken() === token) setPending(false);
    }
  }
  return {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmation,
    setConfirmation,
    pending,
    message,
    failed,
    submit,
  };
}

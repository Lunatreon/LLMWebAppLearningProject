import { minimumPasswordLength } from '../../../utils/passwordValidation';
import { useChangePassword } from './useChangePassword';
import type { AccountResponse } from './types';

export default function ChangePasswordForm({
  account,
  token,
}: {
  account: AccountResponse;
  token: string;
}) {
  const form = useChangePassword(account, token);
  return (
    <form
      id="password-form"
      className="account-section"
      aria-label="Change password"
      aria-busy={form.pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (event.currentTarget.reportValidity()) void form.submit();
      }}
    >
      <div className="account-section-heading">
        <div>
          <p className="eyebrow">Security</p>
          <h3>Change password</h3>
        </div>
        <p>Use at least eight characters and avoid reused passwords.</p>
      </div>
      <div className="account-form-grid">
        {account.has_password && (
          <label id="current-password-field">
            <span>Current password</span>
            <input
              aria-describedby="password-change-status"
              id="account-current-password"
              type="password"
              autoComplete="current-password"
              required
              value={form.currentPassword}
              onChange={(event) => form.setCurrentPassword(event.target.value)}
            />
          </label>
        )}
        <label>
          <span>New password</span>
          <input
            aria-describedby="password-change-status"
            id="account-new-password"
            type="password"
            autoComplete="new-password"
            minLength={minimumPasswordLength}
            value={form.newPassword}
            onChange={(event) => form.setNewPassword(event.target.value)}
          />
        </label>
        <label className="account-field-wide">
          <span>Confirm new password</span>
          <input
            aria-describedby="password-change-status"
            id="account-confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={minimumPasswordLength}
            required
            value={form.confirmation}
            onChange={(event) => form.setConfirmation(event.target.value)}
          />
        </label>
      </div>
      <p id="password-change-status" className="form-error" role={form.failed ? 'alert' : 'status'}>
        {form.message}
      </p>
      <div className="account-section-footer account-section-footer-end">
        <button className="secondary-button" type="submit" disabled={form.pending}>
          Update password
        </button>
      </div>
    </form>
  );
}

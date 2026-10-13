import type { AccountResponse } from '../../types/api';
import { Link, useLocation } from 'react-router-dom';
import { useProfileForm } from './useProfileForm';

export default function ProfileForm({
  account,
  token,
}: {
  account: AccountResponse;
  token: string;
}) {
  const form = useProfileForm(account, token);
  const location = useLocation();
  return (
    <form
      id="account-form"
      className="account-section"
      data-dirty={form.dirty}
      aria-busy={form.saving}
      onSubmit={(event) => {
        event.preventDefault();
        if (event.currentTarget.reportValidity()) void form.save();
      }}
    >
      <div className="account-section-heading">
        <div>
          <p className="eyebrow">Profile</p>
          <h3>Personal details</h3>
        </div>
        <p>Choose how you appear in your private space.</p>
      </div>
      <p id="account-status" className="form-error" role="status">
        {form.status}
      </p>
      <div className="account-form-grid">
        <label>
          <span>Display name</span>
          <input
            aria-describedby="account-status"
            id="account-display-name"
            type="text"
            maxLength={120}
            value={form.values.displayName}
            onChange={(event) => form.setField('displayName', event.target.value)}
          />
        </label>
        <label>
          <span>Username</span>
          <input
            aria-describedby="account-status"
            id="account-username"
            type="text"
            minLength={3}
            maxLength={80}
            required
            value={form.values.username}
            onChange={(event) => form.setField('username', event.target.value)}
          />
        </label>
        <label className="account-field-wide">
          <span>Email</span>
          <input
            aria-describedby="account-status"
            id="account-email"
            type="email"
            required
            value={form.values.email}
            onChange={(event) => form.setField('email', event.target.value)}
          />
        </label>
        <label className="account-field-wide">
          <span>Avatar URL</span>
          <input
            aria-describedby="account-status"
            id="account-avatar-url"
            type="url"
            maxLength={500}
            placeholder="https://..."
            value={form.values.avatarUrl}
            onChange={(event) => form.setField('avatarUrl', event.target.value)}
          />
        </label>
        <label className="account-field-wide">
          <span>Bio</span>
          <textarea
            aria-describedby="account-status"
            id="account-bio"
            rows={3}
            maxLength={500}
            value={form.values.bio}
            onChange={(event) => form.setField('bio', event.target.value)}
          />
        </label>
      </div>
      <div className="account-section-footer">
        <div className="account-row">
          <span id="account-email-status">
            {account.is_email_verified ? 'Email verified' : 'Email not verified'}
          </span>
          {!account.is_email_verified && (
            <Link
              className="secondary-button"
              to={{ pathname: '/activate', search: location.search }}
              state={{ email: account.email, afterLogin: '/account' }}
            >
              Verify email
            </Link>
          )}
        </div>
        {/* The reference permits saving unchanged values. Only pending saves lock it. */}
        <button className="primary-button" type="submit" disabled={form.saving}>
          Save profile
        </button>
      </div>
    </form>
  );
}

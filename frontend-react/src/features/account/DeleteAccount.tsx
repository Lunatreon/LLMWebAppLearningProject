import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../hooks/useSession';
import { DialogFrame, useDialogControls } from '../../components/shared/DialogFrame';
import type { AccountResponse } from '../../types/api';

export default function DeleteAccount({
  account,
  token,
}: {
  account: AccountResponse;
  token: string;
}) {
  const { controller } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(false);
  const alive = useRef(false);
  const { controls, bind } = useDialogControls();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    if (request.current) return;
    setOpen(false);
    setPassword('');
    setConfirmed(false);
    setError('');
  };
  async function remove() {
    if (
      request.current ||
      !confirmed ||
      (account.has_password && !password) ||
      controller.getToken() !== token
    )
      return;
    request.current = true;
    setPending(true);
    setError('');
    try {
      await controller.api.request('/users/me/account', {
        authenticated: true,
        method: 'DELETE',
        body: JSON.stringify({ password: account.has_password ? password : '' }),
      });
      if (controller.getToken() === token) controller.signOut('Your account has been deleted.');
    } catch (failure) {
      if (alive.current && controller.getToken() === token)
        setError(failure instanceof Error ? failure.message : 'Account deletion failed.');
    } finally {
      request.current = false;
      if (alive.current) {
        setPending(false);
        setPassword('');
      }
    }
  }
  return (
    <section className="account-section account-danger">
      <div className="account-section-heading">
        <div>
          <p className="eyebrow">Danger zone</p>
          <h3>Delete account</h3>
        </div>
        <p>Permanently remove your account and private FeelY data.</p>
      </div>
      <button className="secondary-button danger" type="button" onClick={() => setOpen(true)}>
        Delete account
      </button>
      {open && (
        <DialogFrame
          label="Delete your account"
          onClose={close}
          controls={controls}
          busy={pending}
          confirm
        >
          <form
            aria-label="Confirm account deletion"
            onSubmit={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            <h2>Delete your account?</h2>
            <p>
              Your chats, journal, and saved reflections will be permanently deleted. This cannot be
              undone.
            </p>
            <p>
              If you have a paid subscription, cancel it in Stripe before deleting your account.
            </p>
            {account.has_password && (
              <label>
                <span>Password to confirm deletion</span>
                <input
                  ref={bind}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  disabled={pending}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            )}
            <label className="terms-consent-label">
              <input
                ref={bind}
                type="checkbox"
                checked={confirmed}
                required
                disabled={pending}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I understand that my account and private data will be permanently deleted.
              </span>
            </label>
            <p role="alert">{error}</p>
            <div className="billing-actions">
              <button
                ref={bind}
                className="secondary-button"
                type="button"
                disabled={pending}
                onClick={close}
              >
                Keep my account
              </button>
              <button
                ref={bind}
                className="primary-button danger"
                type="submit"
                disabled={pending || !confirmed || (account.has_password && !password)}
              >
                {pending ? 'Deleting account...' : 'Permanently delete account'}
              </button>
            </div>
          </form>
        </DialogFrame>
      )}
    </section>
  );
}

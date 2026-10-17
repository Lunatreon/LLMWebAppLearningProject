import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout from '../AuthLayout';
import { useSession } from '../../../hooks/useSession';

// Older email links remain usable after removal of the old consumer frontend.
export default function ActivationLinkPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { controller } = useSession();
  const [token, setToken] = useState(
    () => new URLSearchParams(location.search).get('verify_email_token') || '',
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const request = useRef(false);
  const alive = useRef(false);
  const params = new URLSearchParams(location.search);
  params.delete('verify_email_token');
  const search = params.size ? `?${params}` : '';
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      location.pathname !== '/activate-link' ||
      new URLSearchParams(location.search).has('verify_email_token')
    )
      navigate({ pathname: '/activate-link', search }, { replace: true });
  }, [location.pathname, location.search, navigate, search]);
  async function confirm() {
    if (request.current || !token) return;
    request.current = true;
    setPending(true);
    setFailed(false);
    const owner = controller.getToken();
    try {
      const result = await controller.api.request<{ verified: boolean; detail: string }>(
        '/auth/email-verification/confirm',
        { method: 'POST', body: JSON.stringify({ token }) },
      );
      if (!alive.current || controller.getToken() !== owner) return;
      if (!result.verified) throw new Error('The verification link could not be confirmed.');
      setToken('');
      setMessage(result.detail);
      if (owner) await controller.reload({ force: true });
    } catch (error) {
      if (alive.current && controller.getToken() === owner) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : 'Email verification failed.');
      }
    } finally {
      request.current = false;
      if (alive.current) setPending(false);
    }
  }
  return (
    <AuthLayout mode="activate" search={search}>
      <h2>Confirm email address</h2>
      {token ? (
        <button
          className="primary-button"
          type="button"
          disabled={pending}
          onClick={() => void confirm()}
        >
          {pending ? 'Confirming...' : 'Confirm email address'}
        </button>
      ) : (
        !message && <p>Open your verification email or request a new activation PIN.</p>
      )}
      <p role={failed ? 'alert' : 'status'}>{message}</p>
      <Link to={{ pathname: '/activate', search }}>Use an activation PIN</Link>
      <Link to={{ pathname: '/login', search }}>Sign in</Link>
    </AuthLayout>
  );
}

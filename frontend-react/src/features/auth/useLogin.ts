import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../hooks/useSession';
import { ApiError } from '../../services/apiClient';
import { login, verificationEnabled } from './authApi';

export function useLogin(initialEmail = '') {
  const { controller } = useSession();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [canActivate, setCanActivate] = useState(false);
  const alive = useRef(false);
  const request = useRef<AbortController | null>(null);
  const lastSubmit = useRef<number | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    let mounted = true;
    void verificationEnabled(controller.api)
      .then((enabled) => {
        if (mounted) setCanActivate(enabled);
      })
      .catch(() => {
        // As in the reference, a public configuration failure never blocks sign-in.
      });
    return () => {
      mounted = false;
    };
  }, [controller]);

  async function submit() {
    const expected = controller.getSnapshot().session;
    if (
      request.current ||
      expected.status !== 'unauthenticated' ||
      !email.trim() ||
      password.length < 8
    )
      return;
    if (lastSubmit.current !== null && Date.now() - lastSubmit.current < 1200) {
      setError('Please wait a moment before trying again.');
      return;
    }
    lastSubmit.current = Date.now();
    const attempt = new AbortController();
    request.current = attempt;
    setPending(true);
    setError('');
    setVerificationRequired(false);
    try {
      const response = await login(controller.api, { email, password }, attempt.signal);
      if (!alive.current || attempt.signal.aborted) return;
      // Credentials stay local to the form. Clear the password after authentication,
      // including when the subsequent shared session load needs a retry.
      setPassword('');
      await controller.establishSession(response.access_token, expected);
    } catch (failure) {
      if (!alive.current || attempt.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : 'Request failed');
      setVerificationRequired(
        failure instanceof ApiError &&
          failure.status === 403 &&
          failure.message.includes('verify your email'),
      );
    } finally {
      if (request.current === attempt) request.current = null;
      if (alive.current) setPending(false);
    }
  }

  return {
    email,
    setEmail,
    password,
    setPassword,
    pending,
    error,
    verificationRequired,
    canActivate,
    submit,
  };
}

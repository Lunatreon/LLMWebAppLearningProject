import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../../../hooks/useSession';
import { hasMinimumPasswordLength } from '../../../utils/passwordValidation';
import { authDestinationState } from '../authRouteState';
import { readResetToken, recoverySearch, resetTokenParameter } from './resetLink';
import { resetPassword } from './recoveryApi';

export function usePasswordReset() {
  const { controller } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const initial = readResetToken(location.search);
  const token = useRef(initial.value);
  const [problem, setProblem] = useState(initial.problem);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const alive = useRef(false);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!new URLSearchParams(location.search).has(resetTokenParameter)) return;
    const link = readResetToken(location.search);
    request.current?.abort();
    request.current = null;
    if (timer.current) clearTimeout(timer.current);
    token.current = link.value;
    setProblem(link.problem);
    setPassword('');
    setConfirmation('');
    setPending(false);
    setDone(false);
    setMessage('');
    setFailed(false);
    // Replace the sensitive URL, never place the token in Router state. App keeps
    // this same component mounted when a legacy root link becomes /reset-password.
    navigate(
      { pathname: '/reset-password', search: recoverySearch(location.search) },
      {
        replace: true,
        state: authDestinationState(location.state, recoverySearch(location.search)),
      },
    );
  }, [location.search, location.state, navigate]);

  async function submit() {
    if (request.current || done) return;
    if (!token.current) {
      setFailed(true);
      setMessage(problem || 'This reset link is missing its token.');
      return;
    }
    if (password !== confirmation) {
      setFailed(true);
      setMessage('The passwords do not match.');
      return;
    }
    if (!hasMinimumPasswordLength(password)) return;
    const submission = new AbortController();
    request.current = submission;
    setPending(true);
    setFailed(false);
    setMessage('Saving...');
    try {
      const result = await resetPassword(
        controller.api,
        token.current,
        password,
        submission.signal,
      );
      if (!alive.current || submission.signal.aborted) return;
      token.current = null;
      setPassword('');
      setConfirmation('');
      setDone(true);
      setMessage(result.detail);
      // Backend reset does not revoke JWTs. Leave the existing controller/token
      // untouched; Login applies its normal authenticated destination policy.
      timer.current = setTimeout(() => {
        if (alive.current)
          navigate(
            { pathname: '/login', search: recoverySearch(location.search) },
            {
              replace: true,
              state: {
                ...authDestinationState(location.state, recoverySearch(location.search)),
                notice: 'password-reset',
              },
            },
          );
      }, 1200);
    } catch (error) {
      if (alive.current && !submission.signal.aborted) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : 'Request failed');
      }
    } finally {
      if (request.current === submission) request.current = null;
      if (alive.current && !submission.signal.aborted) setPending(false);
    }
  }
  return {
    password,
    setPassword,
    confirmation,
    setConfirmation,
    pending,
    done,
    message,
    failed,
    problem,
    submit,
  };
}

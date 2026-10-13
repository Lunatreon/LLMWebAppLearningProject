import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../../../hooks/useSession';
import { handoffEmail } from '../authRouteState';
import { requestPasswordRecovery } from './recoveryApi';

export function usePasswordRecovery() {
  const { controller } = useSession();
  const location = useLocation();
  const [email, setEmail] = useState(() => handoffEmail(location.state));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const alive = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  async function submit() {
    if (request.current || !email.trim()) return;
    const submission = new AbortController();
    request.current = submission;
    setPending(true);
    setFailed(false);
    setMessage('Sending...');
    try {
      const result = await requestPasswordRecovery(controller.api, email, submission.signal);
      if (alive.current && !submission.signal.aborted) setMessage(result.detail);
    } catch (error) {
      if (alive.current && !submission.signal.aborted) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : 'Request failed');
      }
    } finally {
      if (request.current === submission) request.current = null;
      if (alive.current) setPending(false);
    }
  }
  return { email, setEmail, pending, message, failed, submit };
}

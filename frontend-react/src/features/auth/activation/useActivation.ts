import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../../../hooks/useSession';
import { authDestinationState, handoffEmail, handoffNotice } from '../authRouteState';
import { confirmActivation, resendActivation } from './activationApi';

export function useActivation() {
  const { controller } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => handoffEmail(location.state));
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState<'confirm' | 'resend' | null>(null);
  const [message, setMessage] = useState(() => handoffNotice(location.state));
  const [failed, setFailed] = useState(false);
  const [verified, setVerified] = useState(false);
  const alive = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);

  async function mutate(action: 'confirm' | 'resend') {
    if (
      request.current ||
      verified ||
      controller.getSnapshot().session.status === 'loading' ||
      !email.trim() ||
      (action === 'confirm' && !/^[0-9]{6}$/.test(pin))
    )
      return;
    const submission = new AbortController();
    request.current = submission;
    const requestToken = controller.getToken();
    const address = email.trim();
    const returnToLogin = () =>
      navigate(
        { pathname: '/login', search: location.search },
        {
          replace: true,
          state: {
            ...authDestinationState(location.state, location.search),
            email: address,
            notice: 'activated',
          },
        },
      );
    setPending(action);
    setFailed(false);
    setMessage(action === 'confirm' ? 'Activating...' : 'Sending a new PIN...');
    try {
      const result =
        action === 'confirm'
          ? await confirmActivation(controller.api, address, pin, submission.signal)
          : await resendActivation(controller.api, address, submission.signal);
      if (!alive.current || submission.signal.aborted || controller.getToken() !== requestToken)
        return;
      setPin('');
      setMessage(result.detail);
      if (action === 'confirm') {
        setVerified(true);
        if (requestToken) {
          // Verification grants no JWT. Refresh only the already-existing session.
          await controller.reload({ force: true });
          if (
            alive.current &&
            !submission.signal.aborted &&
            controller.getSnapshot().session.status === 'unauthenticated'
          )
            returnToLogin();
        } else returnToLogin();
      }
    } catch (failure) {
      if (alive.current && !submission.signal.aborted && controller.getToken() === requestToken) {
        setFailed(true);
        setMessage(failure instanceof Error ? failure.message : 'Request failed');
      }
    } finally {
      if (request.current === submission) request.current = null;
      if (alive.current) setPending(null);
    }
  }
  return {
    email,
    setEmail,
    pin,
    setPin,
    pending,
    message,
    failed,
    verified,
    confirm: () => mutate('confirm'),
    resend: () => mutate('resend'),
  };
}

import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../hooks/useSession';
import { ApiError } from '../../services/apiClient';
import { acceptTerms } from './termsApi';
import type { PublishedTerms } from './types';

export function useTermsAcceptance() {
  const { session, controller } = useSession();
  const token = session.token;
  const alive = useRef(false);
  const pendingToken = useRef<string | null>(null);
  const [state, setState] = useState({ owner: token, pending: false, error: '' });
  const current = state.owner === token ? state : { owner: token, pending: false, error: '' };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setState((previous) =>
      previous.owner === token ? previous : { owner: token, pending: false, error: '' },
    );
  }, [token]);

  async function submit(displayed: PublishedTerms) {
    if (
      session.status !== 'authenticated' ||
      !token ||
      token !== controller.getToken() ||
      pendingToken.current === token
    )
      return false;
    pendingToken.current = token;
    setState({ owner: token, pending: true, error: '' });
    try {
      await acceptTerms(controller.api, displayed);
      if (token !== controller.getToken()) return false;
      // The POST record alone never grants capabilities. Reread the real session.
      await controller.reload({ force: true });
      const refreshed = controller.getSnapshot().session;
      if (!alive.current || token !== controller.getToken()) return false;
      if (refreshed.status === 'authenticated' && !refreshed.termsRequired) return true;
      setState({
        owner: token,
        pending: true,
        error:
          refreshed.status === 'authenticated'
            ? 'The AGB version changed. Display the current document before accepting.'
            : 'Your acceptance was saved, but your session could not be refreshed. Please retry.',
      });
    } catch (error) {
      if (token !== controller.getToken()) return false;
      if (error instanceof ApiError && error.status === 409)
        await controller.reload({ force: true });
      if (alive.current && token === controller.getToken()) {
        setState({
          owner: token,
          pending: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (pendingToken.current === token) pendingToken.current = null;
      if (alive.current && token === controller.getToken())
        setState((previous) => ({ ...previous, pending: false }));
    }
    return false;
  }

  return { pending: current.pending, error: current.error, submit };
}

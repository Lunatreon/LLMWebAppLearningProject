import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSession } from '../../hooks/useSession';
import { ApiError } from '../../services/apiClient';
import { submitFeedback } from './feedbackApi';
import type { FeedbackCategory } from './types';

interface Draft {
  owner: string | null;
  category: FeedbackCategory;
  message: string;
  submitting: boolean;
  status: string;
}
const emptyDraft = (owner: string | null): Draft => ({
  owner,
  category: 'general',
  message: '',
  submitting: false,
  status: '',
});
interface FeedbackContextValue extends Draft {
  setCategory: (category: FeedbackCategory) => void;
  setMessage: (message: string) => void;
  clearStatus: () => void;
  submit: () => Promise<void>;
}
const FeedbackContext = createContext<FeedbackContextValue | null>(null);

// Like the persistent legacy dialog DOM, preserve the draft across close/reopen
// within one session. Never store it on disk or carry it into another session.
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { session, feedback, controller } = useSession();
  const token = session.token;
  const [stored, setStored] = useState(() => emptyDraft(token));
  const draft = stored.owner === token ? stored : emptyDraft(token);
  const pendingToken = useRef<string | null>(null);

  useEffect(() => {
    // Clear the stored draft as well as its visible projection on logout/change.
    // A later login may produce the same JWT value; it must not revive old text.
    setStored((previous) => (previous.owner === token ? previous : emptyDraft(token)));
  }, [token]);

  const patch = useCallback(
    (change: Partial<Draft>) => {
      setStored((previous) => ({
        ...(previous.owner === token ? previous : emptyDraft(token)),
        ...change,
      }));
    },
    [token],
  );
  const clearStatus = useCallback(() => {
    setStored((previous) =>
      previous.owner === token && !previous.submitting ? { ...previous, status: '' } : previous,
    );
  }, [token]);

  async function submit() {
    if (
      !token ||
      session.status !== 'authenticated' ||
      session.termsRequired ||
      !feedback.enabled ||
      pendingToken.current === token
    )
      return;
    if (draft.message.length < 3 || draft.message.length > 5000) return;
    pendingToken.current = token;
    patch({ submitting: true, status: 'Saving feedback...' });
    try {
      const result = await submitFeedback(controller.api, {
        category: draft.category,
        message: draft.message,
      });
      if (token !== controller.getToken()) return;
      patch({ category: 'general', message: '', status: result.detail });
    } catch (error) {
      if (token !== controller.getToken()) return;
      patch({ status: error instanceof Error ? error.message : String(error) });
      if (error instanceof ApiError && error.status === 404) controller.disableFeedback();
    } finally {
      if (pendingToken.current === token) pendingToken.current = null;
      if (token === controller.getToken()) patch({ submitting: false });
    }
  }

  return (
    <FeedbackContext.Provider
      value={{
        ...draft,
        clearStatus,
        submit,
        setCategory: (category) => patch({ category }),
        setMessage: (message) => patch({ message }),
      }}
    >
      {children}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('FeedbackProvider is required.');
  return context;
}

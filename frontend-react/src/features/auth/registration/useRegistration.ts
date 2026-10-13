import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../../../hooks/useSession';
import { loadCurrentTerms } from '../../terms/termsApi';
import { login } from '../authApi';
import { loadCaptchaConfig, register, registrationPayload } from './registrationApi';
import { sameConsentDocument } from './types';
import type { RegisteredUser, RegistrationConfig, RegistrationFields } from './types';
import { hasMinimumPasswordLength } from '../../../utils/passwordValidation';

export function useRegistration() {
  const { controller } = useSession();
  const [fields, setFields] = useState<RegistrationFields>({
    email: '',
    username: '',
    password: '',
    website: '',
  });
  const [config, setConfig] = useState<RegistrationConfig>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [consent, updateConsent] = useState(false);
  const consentRef = useRef(false);
  const setConsent = useCallback((value: boolean) => {
    consentRef.current = value;
    updateConsent(value);
  }, []);
  const token = useRef('');
  const onCaptchaToken = useCallback((value: string) => {
    token.current = value;
  }, []);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<RegisteredUser | null>(null);
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
    let current = true;
    setConfig({ status: 'loading' });
    setConsent(false);
    token.current = '';
    Promise.all([loadCaptchaConfig(controller.api), loadCurrentTerms(controller.api)])
      .then(([captcha, terms]) => {
        if (current) setConfig({ status: 'ready', captcha, terms });
      })
      .catch((failure) => {
        if (current)
          setConfig({
            status: 'error',
            message: failure instanceof Error ? failure.message : 'Request failed',
          });
      });
    return () => {
      current = false;
    };
  }, [controller, attempt, setConsent]);

  async function submit() {
    const expected = controller.getSnapshot().session;
    if (
      request.current ||
      created ||
      expected.status !== 'unauthenticated' ||
      config.status !== 'ready' ||
      !fields.email.trim() ||
      fields.username.length < 3 ||
      !hasMinimumPasswordLength(fields.password)
    )
      return;
    if (lastSubmit.current !== null && Date.now() - lastSubmit.current < 1200) {
      setError('Please wait a moment before trying again.');
      return;
    }
    lastSubmit.current = Date.now();
    const submission = new AbortController();
    request.current = submission;
    setPending(true);
    setError('');
    try {
      const terms = await loadCurrentTerms(controller.api);
      if (
        !alive.current ||
        submission.signal.aborted ||
        controller.getSnapshot().session !== expected
      )
        return;
      if (!sameConsentDocument(config.terms, terms)) setConsent(false);
      setConfig({ ...config, terms });
      const payload = registrationPayload(
        fields,
        config.captcha,
        token.current,
        terms,
        consentRef.current,
      );
      const user = await register(controller.api, payload, submission.signal);
      if (
        !alive.current ||
        submission.signal.aborted ||
        controller.getSnapshot().session !== expected
      )
        return;
      setCreated(user);
      setFields((previous) => ({ ...previous, email: user.email, password: '' }));
      token.current = '';
      if (user.is_email_verified) {
        // This separate login is the legacy's existing verified-user branch.
        // Register itself never supplies/stores a JWT.
        const response = await login(
          controller.api,
          { email: fields.email, password: fields.password },
          submission.signal,
        );
        if (alive.current && !submission.signal.aborted)
          await controller.establishSession(response.access_token, expected);
      }
    } catch (failure) {
      if (!alive.current || submission.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : 'Request failed');
      token.current = '';
      setResetKey((value) => value + 1);
    } finally {
      if (request.current === submission) request.current = null;
      if (alive.current) setPending(false);
    }
  }
  return {
    fields,
    setFields,
    config,
    consent,
    setConsent,
    onCaptchaToken,
    resetKey,
    pending,
    error,
    created,
    submit,
    retryConfig: () => setAttempt((value) => value + 1),
  };
}

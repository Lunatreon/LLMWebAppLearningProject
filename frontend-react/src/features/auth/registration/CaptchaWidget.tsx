import { useEffect, useRef, useState } from 'react';
import type { CaptchaConfiguration, TurnstileApi, TurnstileOptions } from './types';
import { loadTurnstile } from './turnstileLoader';

export default function CaptchaWidget({
  config,
  resetKey,
  onToken,
}: {
  config: CaptchaConfiguration;
  resetKey: number;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const [api, setApi] = useState<TurnstileApi | undefined>(() => window.turnstile);
  const [status, setStatus] = useState('Loading verification...');
  const [scriptAttempt, setScriptAttempt] = useState(0);
  const supported = config.enabled && config.provider === 'turnstile' && Boolean(config.site_key);
  useEffect(() => {
    if (!supported) return;
    let active = true;
    setStatus('Loading verification...');
    void loadTurnstile()
      .then((provider) => {
        if (active) setApi(provider);
      })
      .catch(() => {
        if (active) {
          onToken('');
          setStatus('Could not load verification. Please try again.');
        }
      });
    return () => {
      active = false;
    };
  }, [supported, scriptAttempt, onToken]);
  useEffect(() => {
    onToken('');
    if (!supported || !api || !container.current) return;
    let active = true;
    const options: TurnstileOptions = {
      sitekey: config.site_key!,
      action: config.action || 'register',
      size: 'flexible',
      callback: (token) => {
        if (active) {
          onToken(token);
          setStatus('');
        }
      },
      'expired-callback': () => {
        if (active) {
          onToken('');
          setStatus('Verification expired. Please verify again.');
        }
      },
      'error-callback': () => {
        if (active) {
          onToken('');
          setStatus('Verification failed to load. Please try again.');
        }
      },
    };
    let id: string;
    try {
      id = api.render(container.current, options);
      widget.current = { api, id };
      setStatus('');
    } catch {
      active = false;
      setStatus('Verification failed to load. Please try again.');
      return;
    }
    return () => {
      active = false;
      widget.current = null;
      onToken('');
      try {
        api.remove(id);
      } catch {
        /* The provider may already have removed its widget. */
      }
    };
  }, [supported, api, config.site_key, config.action, onToken]);

  useEffect(() => {
    if (resetKey && widget.current) {
      onToken('');
      try {
        widget.current.api.reset(widget.current.id);
      } catch {
        setStatus('Verification failed to load. Please try again.');
      }
    }
  }, [resetKey, onToken]);
  if (!config.enabled) return null;
  return (
    <div id="captcha-field" className="captcha-field" aria-label="Account verification">
      <div id="captcha-widget" ref={container} />
      <p id="captcha-status" className="captcha-status" role="status">
        {supported ? status : 'Account verification is not configured.'}
      </p>
      {supported && !api && status === 'Could not load verification. Please try again.' && (
        <button
          className="auth-link-button"
          type="button"
          onClick={() => {
            setStatus('Loading verification...');
            setScriptAttempt((value) => value + 1);
          }}
        >
          Retry verification
        </button>
      )}
    </div>
  );
}

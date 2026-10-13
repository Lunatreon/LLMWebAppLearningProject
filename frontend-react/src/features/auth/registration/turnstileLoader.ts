import type { TurnstileApi } from './types';

export const turnstileScriptUrl =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  // React does not execute component-rendered scripts. This isolated dependency
  // loader owns only the official SDK script, never application content/events.
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = turnstileScriptUrl;
    script.async = true;
    script.defer = true;
    const fail = () => {
      script.onload = null;
      script.onerror = null;
      script.remove();
      reject(new Error('Could not load verification. Please try again.'));
    };
    script.onload = () => {
      if (!window.turnstile) {
        fail();
        return;
      }
      script.onload = null;
      script.onerror = null;
      resolve(window.turnstile);
    };
    script.onerror = fail;
    document.head.append(script);
  });
  const request = loading;
  const clear = () => {
    if (loading === request) loading = null;
  };
  void request.then(clear, clear);
  return request;
}

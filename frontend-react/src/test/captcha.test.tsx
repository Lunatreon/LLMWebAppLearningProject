import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import CaptchaWidget from '../features/auth/registration/CaptchaWidget';
import type { TurnstileOptions } from '../features/auth/registration/types';
import { turnstileScriptUrl } from '../features/auth/registration/turnstileLoader';

afterEach(async () => {
  await act(async () => {
    for (const script of Array.from(document.scripts).filter(
      (script) => script.src === turnstileScriptUrl,
    )) {
      fireEvent.error(script);
      script.remove();
    }
  });
});

const config = { enabled: true, provider: 'turnstile', site_key: 'public-key', action: 'register' };
function sdk() {
  return {
    render: vi.fn((_element: HTMLElement, _options: TurnstileOptions) => 'widget-id'),
    reset: vi.fn(),
    remove: vi.fn(),
  };
}

describe('Turnstile React boundary', () => {
  test('loads the official explicit SDK through an isolated loader and renders into its own ref using public options', async () => {
    const onToken = vi.fn();
    render(<CaptchaWidget config={config} resetKey={0} onToken={onToken} />);
    expect(screen.getByText('Loading verification...')).toBeDefined();
    const script = document.head.querySelector<HTMLScriptElement>('script')!;
    expect(script.src).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    );
    expect(script.async).toBe(true);
    expect(script.defer).toBe(true);
    const api = sdk();
    vi.stubGlobal('turnstile', api);
    fireEvent.load(script);
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    expect(api.render.mock.calls[0][0].id).toBe('captcha-widget');
    expect(api.render.mock.calls[0][1]).toMatchObject({
      sitekey: 'public-key',
      action: 'register',
      size: 'flexible',
    });
    expect(Object.keys(api.render.mock.calls[0][1])).not.toContain('secret');
  });

  test('callback/expiry/error token lifecycle preserves the original status text', () => {
    const api = sdk();
    vi.stubGlobal('turnstile', api);
    const onToken = vi.fn();
    render(<CaptchaWidget config={config} resetKey={0} onToken={onToken} />);
    const options = api.render.mock.calls[0][1];
    act(() => options.callback('synthetic-challenge'));
    expect(onToken).toHaveBeenLastCalledWith('synthetic-challenge');
    act(() => options['expired-callback']());
    expect(onToken).toHaveBeenLastCalledWith('');
    expect(screen.getByText('Verification expired. Please verify again.')).toBeDefined();
    act(() => options['error-callback']());
    expect(onToken).toHaveBeenLastCalledWith('');
    expect(screen.getByText('Verification failed to load. Please try again.')).toBeDefined();
  });

  test('failed submission reset clears token, resets only its widget and cleanup rejects late callbacks', () => {
    const api = sdk();
    vi.stubGlobal('turnstile', api);
    const onToken = vi.fn();
    const view = render(<CaptchaWidget config={config} resetKey={0} onToken={onToken} />);
    const options = api.render.mock.calls[0][1];
    act(() => options.callback('synthetic-challenge'));
    view.rerender(<CaptchaWidget config={config} resetKey={1} onToken={onToken} />);
    expect(api.reset).toHaveBeenCalledWith('widget-id');
    expect(onToken).toHaveBeenLastCalledWith('');
    view.unmount();
    expect(api.remove).toHaveBeenCalledWith('widget-id');
    onToken.mockClear();
    options.callback('late-challenge');
    expect(onToken).not.toHaveBeenCalled();
  });

  test('script failure remains unverified and can retry without disabling provider protection', async () => {
    const onToken = vi.fn();
    render(<CaptchaWidget config={config} resetKey={0} onToken={onToken} />);
    const script = document.head.querySelector<HTMLScriptElement>('script')!;
    fireEvent.error(script);
    await screen.findByText('Could not load verification. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry verification' }));
    expect(document.head.querySelector('script')).not.toBe(script);
    expect(screen.getByText('Loading verification...')).toBeDefined();
    expect(onToken).toHaveBeenLastCalledWith('');
  });

  test('disabled configuration never loads the external script or widget', () => {
    const api = sdk();
    vi.stubGlobal('turnstile', api);
    const view = render(
      <CaptchaWidget config={{ ...config, enabled: false }} resetKey={0} onToken={vi.fn()} />,
    );
    expect(view.container.childElementCount).toBe(0);
    expect(api.render).not.toHaveBeenCalled();
  });

  test.each([
    { ...config, provider: 'unsupported' },
    { ...config, site_key: null },
  ])('unsupported/unconfigured provider exposes original error without issuing a token', (cfg) => {
    const api = sdk();
    vi.stubGlobal('turnstile', api);
    const onToken = vi.fn();
    render(<CaptchaWidget config={cfg} resetKey={0} onToken={onToken} />);
    expect(screen.getByText('Account verification is not configured.')).toBeDefined();
    expect(api.render).not.toHaveBeenCalled();
    expect(onToken).toHaveBeenLastCalledWith('');
  });

  test('site/action configuration changes remove the old widget and clear its challenge', () => {
    const api = sdk();
    vi.stubGlobal('turnstile', api);
    const onToken = vi.fn();
    const view = render(<CaptchaWidget config={config} resetKey={0} onToken={onToken} />);
    const old = api.render.mock.calls[0][1];
    view.rerender(
      <CaptchaWidget
        config={{ ...config, action: null, site_key: 'new-public-key' }}
        resetKey={0}
        onToken={onToken}
      />,
    );
    expect(api.remove).toHaveBeenCalledWith('widget-id');
    expect(api.render.mock.calls[1][1].action).toBe('register');
    onToken.mockClear();
    old.callback('late');
    expect(onToken).not.toHaveBeenCalled();
  });

  test('concurrent widget mounts share one pending SDK load and render into separate refs', async () => {
    const firstToken = vi.fn();
    const secondToken = vi.fn();
    render(
      <>
        <CaptchaWidget config={config} resetKey={0} onToken={firstToken} />
        <CaptchaWidget config={config} resetKey={0} onToken={secondToken} />
      </>,
    );
    const scripts = Array.from(document.scripts).filter(
      (script) => script.src === turnstileScriptUrl,
    );
    expect(scripts.length).toBe(1);
    const api = sdk();
    vi.stubGlobal('turnstile', api);
    fireEvent.load(scripts[0]);
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
    expect(api.render.mock.calls[0][0]).not.toBe(api.render.mock.calls[1][0]);
  });

  test('leaving while the SDK loads never renders a widget or updates a dead form', async () => {
    const onToken = vi.fn();
    const view = render(<CaptchaWidget config={config} resetKey={0} onToken={onToken} />);
    const script = Array.from(document.scripts).find(
      (script) => script.src === turnstileScriptUrl,
    )!;
    view.unmount();
    onToken.mockClear();
    const api = sdk();
    vi.stubGlobal('turnstile', api);
    await act(async () => fireEvent.load(script));
    expect(api.render).not.toHaveBeenCalled();
    expect(onToken).not.toHaveBeenCalled();
  });
});

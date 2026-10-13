import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { FeedbackProvider } from '../features/feedback/FeedbackContext';
import { SessionController } from '../services/sessionController';
import type { TermsAcceptance, TermsConfiguration } from '../types/api';
import { account, deferred, json, jwt, mockBackend, subscription } from './backend';

const published: TermsConfiguration = {
  configured: true,
  enforced: true,
  version: 'v1',
  document_url: 'https://example.com/agb/v1.pdf',
  document_sha256: 'a'.repeat(64),
};
const acceptance: TermsAcceptance = {
  version: 'v1',
  document_url: published.document_url!,
  document_sha256: published.document_sha256!,
  accepted_at: '2026-10-11T00:00:00Z',
  client: 'web',
};

function mount(
  options: {
    path?: string;
    signedIn?: boolean;
    configured?: boolean;
    accepted?: boolean;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  if (options.signedIn !== false) localStorage.setItem('feely_token', jwt());
  let accepted = options.accepted ?? false;
  const current =
    options.configured === false
      ? {
          ...published,
          configured: false,
          enforced: false,
          version: null,
          document_url: null,
          document_sha256: null,
        }
      : published;
  const fetch = mockBackend({
    '/terms/config': () => json(current),
    '/terms/me': () =>
      json({ current, accepted_current: accepted, acceptances: accepted ? [acceptance] : [] }),
    '/terms/accept': () => {
      accepted = true;
      return json(acceptance);
    },
    '/feedback': () => json({ id: 1, detail: 'Saved feedback' }, 201),
    ...options.overrides,
  });
  const controller = new SessionController('http://127.0.0.1:8000/api/v1');
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <SessionProvider controller={controller}>
            <FeedbackProvider>
              <App />
            </FeedbackProvider>
          </SessionProvider>
        ),
      },
    ],
    { initialEntries: [options.path ?? '/terms'] },
  );
  render(<RouterProvider router={router} />);
  const posts = () => fetch.mock.calls.filter((call) => String(call[0]).endsWith('/terms/accept'));
  return { router, controller, fetch, posts };
}

const consentLabel = 'I accept this version of the FeelY terms of use (AGB).';
async function consent() {
  const user = userEvent.setup();
  const checkbox = (await screen.findByRole('checkbox', {
    name: consentLabel,
  })) as HTMLInputElement;
  await user.click(checkbox);
  return { user, checkbox };
}

describe('React terms and feature gating', () => {
  test('loads current terms and shows the exact published version/document with unchecked consent', async () => {
    const response = deferred<Response>();
    mount({ overrides: { '/terms/me': () => response.promise.then((value) => value.clone()) } });
    expect(screen.getByText('Loading your session...')).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
    await act(() =>
      response.resolve(json({ current: published, accepted_current: false, acceptances: [] })),
    );
    const checkbox = (await screen.findByRole('checkbox', {
      name: consentLabel,
    })) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const link = screen.getByRole('link', {
      name: 'Read / save the terms (v1)',
    }) as HTMLAnchorElement;
    expect(link.href).toBe(published.document_url);
    expect(link.target).toBe('_blank');
    expect(
      (screen.getByRole('button', { name: 'Accept and continue' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText('Please read and accept the current terms before continuing.'),
    ).toBeDefined();
  });

  test('unpublished terms do not prompt or record acceptance and do not gate Feedback', async () => {
    const { posts, router } = mount({ configured: false });
    await screen.findByText('The FeelY terms are being prepared and have not been published yet.');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(posts().length).toBe(0);
    await act(() => router.navigate('/feedback'));
    await screen.findByLabelText('Your feedback');
  });

  test('already accepted terms support manual reading without another consent or POST', async () => {
    const { posts } = mount({ accepted: true });
    await screen.findByText('You have accepted the current terms.');
    expect(screen.getByText('Current version: v1')).toBeDefined();
    expect(
      (screen.getByRole('link', { name: 'Read / save current terms' }) as HTMLAnchorElement).href,
    ).toBe(published.document_url);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(posts().length).toBe(0);
  });

  test('signed-out users can load the public document but cannot submit acceptance', async () => {
    const { fetch, posts } = mount({ signedIn: false });
    await screen.findByText('Current version: v1');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(posts().length).toBe(0);
    expect(
      fetch.mock.calls.every((call) => !new Headers(call[1]?.headers).has('Authorization')),
    ).toBe(true);
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/terms/me'))).toBe(false);
  });

  test('public terms loading/error supports retry', async () => {
    const pending = deferred<Response>();
    const { fetch } = mount({
      signedIn: false,
      overrides: { '/terms/config': () => pending.promise },
    });
    await screen.findByText('Loading current terms…');
    await act(() => pending.resolve(json({ detail: 'Terms unavailable' }, 503)));
    await screen.findByText('Terms unavailable');
    fetch.mockImplementation(async (input) =>
      String(input).endsWith('/terms/config') ? json(published) : json({ enabled: true }),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry terms' }));
    await screen.findByText('Current version: v1');
  });

  test('required terms block Feedback until explicit consent, then reload and restore its route', async () => {
    const { router, controller, posts, fetch } = mount({ path: '/feedback' });
    const user = userEvent.setup();
    const review = await screen.findByRole('link', { name: 'Review terms' });
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/feedback'))).toBe(false);
    await user.click(review);
    expect(router.state.location.pathname).toBe('/terms');
    const { checkbox } = await consent();
    fireEvent.submit(checkbox.closest('form')!);
    await screen.findByLabelText('Your feedback');
    expect(router.state.location.pathname).toBe('/feedback');
    expect(posts().length).toBe(1);
    const options = posts()[0][1]!;
    expect(JSON.parse(String(options.body))).toEqual({
      accepted: true,
      version: 'v1',
      document_sha256: 'a'.repeat(64),
      client: 'web',
    });
    expect(new Headers(options.headers).get('Authorization')).toBe(
      `Bearer ${localStorage.getItem('feely_token')}`,
    );
    expect(options.credentials).toBeUndefined();
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'authenticated',
      termsRequired: false,
      terms: { accepted_current: true },
    });
    expect(
      fetch.mock.calls.filter((call) => String(call[0]).endsWith('/users/me/account')).length,
    ).toBeGreaterThan(1);
    expect(
      fetch.mock.calls.filter((call) => String(call[0]).endsWith('/billing/subscription')).length,
    ).toBeGreaterThan(1);
  });

  test('session reload reads changed capabilities, and no gated access appears while it is pending', async () => {
    let accepted = false;
    const refreshedAccount = deferred<Response>();
    const { router, controller } = mount({
      path: '/feedback',
      overrides: {
        '/terms/me': () =>
          json({ current: published, accepted_current: accepted, acceptances: [] }),
        '/terms/accept': () => {
          accepted = true;
          return json(acceptance);
        },
        '/users/me/account': () => (accepted ? refreshedAccount.promise : json(account)),
        '/billing/subscription': () =>
          json({ ...subscription, my_map_access: accepted, journal_access: accepted }),
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Review terms' }));
    await consent();
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));
    await screen.findByText('Loading your session...');
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
    expect(controller.getSnapshot().session.status).toBe('loading');
    await act(() => refreshedAccount.resolve(json(account)));
    await screen.findByLabelText('Your feedback');
    expect(router.state.location.pathname).toBe('/feedback');
    expect(controller.getSnapshot().session).toMatchObject({
      subscription: { my_map_access: true, journal_access: true },
    });
  });

  test('failed POST retains checked consent and token, stays gated, and allows retry', async () => {
    let failing = true;
    let accepted = false;
    const { posts, controller } = mount({
      overrides: {
        '/terms/me': () =>
          json({ current: published, accepted_current: accepted, acceptances: [] }),
        '/terms/accept': () => {
          if (failing) return json({ detail: 'Acceptance unavailable' }, 503);
          accepted = true;
          return json(acceptance);
        },
      },
    });
    const { user, checkbox } = await consent();
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));
    await screen.findByText('Acceptance unavailable');
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'authenticated',
      termsRequired: true,
    });
    expect(localStorage.getItem('feely_token')).not.toBeNull();
    expect(posts().length).toBe(1);
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));
    await waitFor(() =>
      expect(controller.getSnapshot().session).toMatchObject({ termsRequired: false }),
    );
    expect(posts().length).toBe(2);
  });

  test('pending acceptance disables consent and rejects repeated form submission', async () => {
    const pending = deferred<Response>();
    const { posts } = mount({ overrides: { '/terms/accept': () => pending.promise } });
    const { user, checkbox } = await consent();
    const form = checkbox.closest('form')!;
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect(checkbox.disabled).toBe(true);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(posts().length).toBe(1);
    await act(() => pending.resolve(json({ detail: 'Not saved' }, 500)));
    await screen.findByText('Not saved');
    expect(checkbox.disabled).toBe(false);
  });

  test.each(['version', 'hash', 'url'])(
    '409 refreshes a changed %s and requires fresh unchecked consent',
    async (changed) => {
      let current = { ...published };
      mount({
        overrides: {
          '/terms/me': () => json({ current, accepted_current: false, acceptances: [] }),
          '/terms/accept': () => {
            current =
              changed === 'version'
                ? { ...current, version: 'v2', document_url: 'https://example.com/agb/v2.pdf' }
                : changed === 'hash'
                  ? { ...current, document_sha256: 'b'.repeat(64) }
                  : { ...current, document_url: 'https://example.com/agb/corrected.pdf' };
            return json(
              { detail: 'The AGB document changed. Read the current document before accepting.' },
              409,
            );
          },
        },
      });
      const { user } = await consent();
      await user.click(screen.getByRole('button', { name: 'Accept and continue' }));
      await screen.findByText(
        'The AGB document changed. Read the current document before accepting.',
      );
      expect(
        (screen.getByRole('checkbox', { name: consentLabel }) as HTMLInputElement).checked,
      ).toBe(false);
      expect(
        (screen.getByRole('button', { name: 'Accept and continue' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (
          screen.getByRole('link', {
            name: `Read / save the terms (${current.version})`,
          }) as HTMLAnchorElement
        ).href,
      ).toBe(current.document_url);
    },
  );

  test('a successful POST followed by failed refresh never grants local capabilities', async () => {
    let saved = false;
    const { controller, router } = mount({
      overrides: {
        '/terms/accept': () => {
          saved = true;
          return json(acceptance);
        },
        '/users/me/account': () =>
          saved ? json({ detail: 'Session refresh unavailable' }, 503) : json(account),
      },
    });
    const { user } = await consent();
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));
    await screen.findByText(
      'Your acceptance was saved, but your session could not be refreshed. Please retry.',
    );
    expect(controller.getSnapshot().session.status).toBe('error');
    expect(router.state.location.pathname).toBe('/terms');
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).toBeNull();
    expect(localStorage.getItem('feely_token')).not.toBeNull();
  });

  test('forced post-write refresh cannot reuse or be overwritten by an older in-flight terms read', async () => {
    localStorage.setItem('feely_token', jwt());
    mockBackend({
      '/terms/me': () => json({ current: published, accepted_current: false, acceptances: [] }),
    });
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    await controller.reload();
    const old = deferred<Response>();
    mockBackend({ '/terms/me': () => old.promise });
    const earlier = controller.reload();
    mockBackend({
      '/terms/me': () =>
        json({ current: published, accepted_current: true, acceptances: [acceptance] }),
    });
    await controller.reload({ force: true });
    old.resolve(json({ current: published, accepted_current: false, acceptances: [] }));
    await earlier;
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'authenticated',
      termsRequired: false,
    });
    controller.stop();
  });

  test('a newly published version during acceptance remains gated after reload', async () => {
    let current = { ...published };
    mount({
      overrides: {
        '/terms/me': () => json({ current, accepted_current: false, acceptances: [] }),
        '/terms/accept': () => {
          current = { ...published, version: 'v2' };
          return json(acceptance);
        },
      },
    });
    const { user } = await consent();
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));
    await screen.findByRole('link', { name: 'Read / save the terms (v2)' });
    expect((screen.getByRole('checkbox', { name: consentLabel }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
  });

  test('network failure does not replay acceptance and displays the legacy connection error', async () => {
    const { posts } = mount({
      overrides: { '/terms/accept': () => Promise.reject(new TypeError('Offline')) },
    });
    const { user } = await consent();
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(posts().length).toBe(1);
  });

  test('Escape and route navigation cannot bypass required terms; account exemptions stay available', async () => {
    const { router } = mount();
    const { user } = await consent();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('checkbox', { name: consentLabel })).toBeDefined();
    await act(() => router.navigate('/map'));
    await screen.findByRole('link', { name: 'Review terms' });
    expect(screen.queryByText('This map page is not migrated yet.', { exact: false })).toBeNull();
    await act(() => router.navigate('/account'));
    expect(await screen.findByRole('heading', { name: 'Personal details' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Read FeelY terms of use (AGB)' })).toBeDefined();
  });

  test('sign-out is available during required review and retains public reading without acceptance', async () => {
    mount();
    const { user, checkbox } = await consent();
    await user.click(within(checkbox.closest('form')!).getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('link', { name: 'Sign in' });
    await screen.findByText('Current version: v1');
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  test.each(['/agb.html', '/?view=terms'])(
    'required users can open the terms alias %s directly',
    async (path) => {
      const { router } = mount({ path });
      await screen.findByRole('checkbox', { name: consentLabel });
      expect(router.state.location.pathname).toBe('/terms');
    },
  );

  test('manual account link and legacy /agb.html alias open the real terms route without new workspace tabs', async () => {
    const { router } = mount({ accepted: true, path: '/account?api_base=custom#review' });
    await screen.findByText('member@example.test');
    await userEvent
      .setup()
      .click(screen.getByRole('link', { name: 'Read FeelY terms of use (AGB)' }));
    await screen.findByText('You have accepted the current terms.');
    expect(router.state.location.pathname).toBe('/terms');
    expect(router.state.location.search).toBe('?api_base=custom');
    expect(within(screen.getByRole('tablist')).getAllByRole('tab').length).toBe(2);
    await act(() => router.navigate('/agb.html?api_base=custom#review'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/terms'));
    expect(router.state.location.hash).toBe('#review');
  });
});

import { renderApp } from './renderApp';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { SessionController } from '../services/sessionController';
import { reflectionPrompt } from '../features/reflection/types';
import { mapBackend, mapData, mapEntry, topic } from './mapBackend';
import { account, deferred, json, jwt, subscription, terms } from './backend';
import { setMobileViewport } from './setup';
const practice = (id = 'p') =>
  mapEntry(id, 'Pause before reacting', 'practice', { source_journal_date: '2026-10-12' });
function mount(
  options: Parameters<typeof mapBackend>[0] & {
    path?: string;
    source?: unknown;
    state?: object;
    signedIn?: boolean;
    access?: boolean;
  } = {},
) {
  if (options.signedIn !== false) localStorage.setItem('feely_token', jwt());
  const backend = mapBackend({
    initial: mapData([], [practice()]),
    ...options,
    overrides: {
      '/billing/subscription': () =>
        json({ ...subscription, my_map_access: options.access !== false }),
      ...options.overrides,
    },
  });
  const session = new SessionController('http://127.0.0.1:8000/api/v1');
  const view = renderApp({
    session,
    path: options.path || '/reflection',
    state: { practiceId: options.source === undefined ? 'p' : options.source, ...options.state },
  });
  return { ...backend, ...view, session };
}
async function answer() {
  await screen.findByRole('dialog', { name: 'Practice reflection' });
  const input = (await screen.findByLabelText(reflectionPrompt)) as HTMLTextAreaElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}
async function completeMapLink() {
  fireEvent.click(await screen.findByRole('button', { name: 'Open Overall' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Complete' }));
  return answer();
}
describe('real Reflection modal and Practice -> Map completion', () => {
  test('original dialog/form/copy/rows/optional input and real Map background render, without new questions', async () => {
    mount();
    const input = await answer();
    const dialog = screen.getByRole('dialog', { name: 'Practice reflection' });
    expect(dialog.id).toBe('reflection-dialog');
    expect(dialog.classList.contains('app-dialog')).toBe(true);
    expect(input.id).toBe('practice-reflection');
    expect(input.rows).toBe(5);
    expect(input.required).toBe(false);
    expect(input.hasAttribute('maxlength')).toBe(false);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(within(dialog).getByText('Review without shame')).toBeDefined();
    expect(
      within(dialog).getByRole('heading', { name: 'What happened when you tried it?' }),
    ).toBeDefined();
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByText('Shared shell active')).toBeNull();
    expect(document.title).toBe('My Map | FeelY');
    await waitFor(() => expect(document.getElementById('map-content')).not.toBeNull());
  });
  test.each([null, 3, ' '])(
    'direct route with invalid/missing %j source does not fabricate standalone Reflection',
    async (source) => {
      const { writes } = mount({ source });
      await screen.findByText('Choose a practice in My Map to reflect on.');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(writes()).toHaveLength(0);
      fireEvent.click(screen.getByRole('link', { name: 'Return to My Map' }));
      await screen.findByRole('button', { name: 'Open Overall' });
    },
  );
  test('unknown/wrong-kind source shows explicit missing practice state and no completion write', async () => {
    const { writes } = mount({
      source: 'note',
      initial: mapData([], [mapEntry('note', 'A note')]),
    });
    await screen.findByText('Practice not found.');
    expect(
      (screen.getByRole('button', { name: 'Mark complete' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(writes()).toHaveLength(0);
  });
  test('source loading/error/retry is explicit and retains source identity', async () => {
    const response = deferred<Response>();
    let read = () => response.promise;
    mount({ read: () => read() });
    await screen.findByText('Loading practice...');
    expect((screen.getByLabelText(reflectionPrompt) as HTMLTextAreaElement).disabled).toBe(true);
    await act(() => response.resolve(json({ detail: 'Practice loading unavailable' }, 503)));
    await screen.findByRole('button', { name: 'Retry practice' });
    read = () => Promise.resolve(json(mapData([], [practice()])));
    fireEvent.click(screen.getByRole('button', { name: 'Retry practice' }));
    await answer();
    expect(screen.queryByText('Practice loading unavailable')).toBeNull();
  });
  test('Map Complete opens real Reflection; authoritative success returns to same selected details and displays saved text', async () => {
    const { writes, router } = mount({ path: '/map' });
    const input = await completeMapLink();
    fireEvent.change(input, { target: { value: '  It gave me room to think. \n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await screen.findByText('Completed');
    await screen.findByText('It gave me room to think.');
    expect(router.state.location.pathname).toBe('/map');
    expect(screen.getByRole('complementary', { name: 'Overall details' })).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      status: 'completed',
      reflection: 'It gave me room to think.',
    });
    expect(localStorage.getItem('feely_token')).not.toBeNull();
    expect(Object.values(router.state.location.state || {})).not.toContain(
      'It gave me room to think.',
    );
  });
  test('normal completion preserves topic/source/creation metadata and consumes normalized backend response', async () => {
    const original = practice();
    const completed = {
      ...original,
      status: 'completed' as const,
      reflection: 'Canonical',
      updated_at: '2026-10-12T14:00:00+00:00',
    };
    mount({
      initial: mapData([
        topic('t', 'Topic', { entries: [original], journal_dates: ['2026-10-12'] }),
      ]),
      write: () =>
        json({
          practice: completed,
          map: mapData([
            topic('t', 'Topic', { entries: [completed], journal_dates: ['2026-10-12'] }),
          ]),
        }),
    });
    fireEvent.change(await answer(), { target: { value: 'Original input' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await screen.findByRole('button', { name: 'Open Topic' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Topic' }));
    await screen.findByText('Canonical');
  });
  test.each(['', '  \n '])('optional %j reflection completes with null', async (value) => {
    const { writes } = mount();
    fireEvent.change(await answer(), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      status: 'completed',
      reflection: null,
    });
  });
  test('pending submit uses original copy, protects doubles and cannot show completion before response', async () => {
    const response = deferred<Response>();
    const { writes } = mount({ write: () => response.promise });
    const input = await answer();
    fireEvent.change(input, { target: { value: 'Before confirmation' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    await screen.findByRole('button', { name: 'Completing...' });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.queryByText('This practice is already completed.')).toBeNull();
    const saved = {
      ...practice(),
      status: 'completed' as const,
      reflection: 'Before confirmation',
    };
    await act(() => response.resolve(json({ practice: saved, map: mapData([], [saved]) })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  test('server 422 retains raw answers and permits correction/retry without a new client maximum', async () => {
    let fail = true;
    const { writes } = mount({
      write: (_path, init) =>
        fail
          ? json({ detail: [{ msg: 'String should have at most 2000 characters' }] }, 422)
          : json({
              practice: { ...practice(), ...JSON.parse(String(init.body)) },
              map: mapData([], [{ ...practice(), ...JSON.parse(String(init.body)) }]),
            }),
    });
    const input = await answer();
    fireEvent.change(input, { target: { value: 'x'.repeat(2001) } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await screen.findByText('String should have at most 2000 characters');
    expect(input.value).toHaveLength(2001);
    fail = false;
    fireEvent.change(input, { target: { value: 'Corrected' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toHaveLength(2);
  });
  test('failed network write preserves input/active state and never automatically retries PATCH', async () => {
    const { writes } = mount({ write: () => Promise.reject(new TypeError('Offline')) });
    const input = await answer();
    fireEvent.change(input, { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await within(screen.getByRole('dialog')).findByText(
      'FeelY temporarily lost its connection. Please try again in a moment.',
    );
    expect(input.value).toBe('Keep me');
    expect(writes()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeDefined();
  });
  test('newer typing during a pending success remains in the open form until explicitly saved', async () => {
    const response = deferred<Response>();
    let calls = 0;
    mount({
      write: (_path, init) =>
        ++calls === 1
          ? response.promise
          : json({
              practice: { ...practice(), ...JSON.parse(String(init.body)) },
              map: mapData([], [{ ...practice(), ...JSON.parse(String(init.body)) }]),
            }),
    });
    const input = await answer();
    fireEvent.change(input, { target: { value: 'First' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await screen.findByRole('button', { name: 'Completing...' });
    fireEvent.change(input, { target: { value: 'Newer' } });
    const saved = { ...practice(), status: 'completed' as const, reflection: 'First' };
    await act(() => response.resolve(json({ practice: saved, map: mapData([], [saved]) })));
    await screen.findByText('Practice completed. Your later changes have not been saved.');
    expect(input.value).toBe('Newer');
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  test('Close/Escape discard only explicitly closed draft, return safely to Map and make no mutation', async () => {
    const { writes, router } = mount({ state: { returnTo: 'https://untrusted.example/' } });
    const input = await answer();
    fireEvent.change(input, { target: { value: 'Explicitly close' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(writes()).toHaveLength(0);
    await completeMapLink();
    expect((screen.getByLabelText(reflectionPrompt) as HTMLTextAreaElement).value).toBe('');
  });
  test('closing during submission does not cancel persistence or redirect after later navigation', async () => {
    const response = deferred<Response>();
    const { router } = mount({ write: () => response.promise });
    const input = await answer();
    fireEvent.change(input, { target: { value: 'Saved after close' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await screen.findByRole('button', { name: 'Completing...' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    await act(() => router.navigate('/account'));
    const saved = { ...practice(), status: 'completed' as const, reflection: 'Saved after close' };
    await act(() => response.resolve(json({ practice: saved, map: mapData([], [saved]) })));
    await screen.findByLabelText('Display name');
    expect(router.state.location.pathname).toBe('/account');
  });
  test('already completed source shows saved reflection read-only and never edits it by reopening', async () => {
    const { writes } = mount({
      initial: mapData([], [{ ...practice(), status: 'completed', reflection: 'Saved earlier' }]),
    });
    const input = await answer();
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('Saved earlier');
    await screen.findByText('This practice is already completed.');
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Return to My Map' }));
  });
  test('paused practice can complete; reopening active reflection starts blank', async () => {
    const { writes } = mount({
      initial: mapData([], [{ ...practice(), status: 'paused', reflection: 'Older note' }]),
    });
    expect((await answer()).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toHaveLength(1);
  });
  test('unauthenticated/Terms/capability gates do not load protected practice data', async () => {
    const { fetch } = mount({ signedIn: false });
    await screen.findByRole('form', { name: 'Login' });
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/users/me/map'))).toBe(false);
  });
  test('capability gate delegates reference billing and no practice source is fabricated', async () => {
    const { fetch } = mount({ access: false });
    await screen.findByText('Turn conversations into your personal map');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/users/me/map'))).toBe(false);
  });
  test('enforced Terms block Reflection until existing session requirements are fulfilled', async () => {
    const { fetch } = mount({
      overrides: {
        '/terms/me': () => json({ ...terms, current: { ...terms.current, enforced: true } }),
      },
    });
    await screen.findByRole('link', { name: 'Review terms' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/users/me/map'))).toBe(false);
  });
  test('401 completion expires shared session and clears private answer', async () => {
    const { router } = mount({ write: () => json({ detail: 'Revoked' }, 401) });
    const input = await answer();
    fireEvent.change(input, { target: { value: 'Private' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(router.state.location.pathname).toBe('/login');
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(screen.queryByDisplayValue('Private')).toBeNull();
  });
  test('403 is not expiry and keeps answer available for existing session/verification recovery', async () => {
    const { session } = mount({
      write: () => json({ detail: 'Please verify your email before logging in.' }, 403),
      overrides: { '/users/me/account': () => json({ ...account, is_email_verified: false }) },
    });
    const input = await answer();
    fireEvent.change(input, { target: { value: 'Retained draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await within(screen.getByRole('dialog')).findByText(
      'Please verify your email before logging in.',
    );
    expect(input.value).toBe('Retained draft');
    expect(session.getToken()).not.toBeNull();
  });
  test('same-owner session refresh keeps answers through loading/remounts', async () => {
    const { session } = mount();
    fireEvent.change(await answer(), { target: { value: 'Survives refresh' } });
    await act(() => session.reload({ force: true }));
    expect((await answer()).value).toBe('Survives refresh');
  });
  test('mobile modal uses original dialog classes and traps focus without background navigation', async () => {
    setMobileViewport(true);
    mount();
    const input = await answer();
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close' }),
      submit = within(dialog).getByRole('button', { name: 'Mark complete' });
    expect(document.getElementsByTagName('main')[0].hasAttribute('inert')).toBe(true);
    submit.focus();
    fireEvent.keyDown(submit, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submit);
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.keyDown(input, { key: 'Escape' });
  });
  test('Terms 423 -> real review/acceptance -> same Reflection source retains its answers', async () => {
    const current = {
      configured: true,
      enforced: true,
      version: 'reflection-v1',
      document_url: 'https://example.test/agb.pdf',
      document_sha256: 'a'.repeat(64),
    };
    let accepted = true,
      first = true;
    const { router, writes } = mount({
      overrides: {
        '/terms/me': () => json({ current, accepted_current: accepted, acceptances: [] }),
        '/terms/accept': () => {
          accepted = true;
          return json({ current, accepted_current: true, acceptances: [] });
        },
      },
      write: (_path, init) => {
        if (first) {
          first = false;
          accepted = false;
          return json({ detail: 'Please accept the current FeelY AGB before continuing.' }, 423);
        }
        const saved = { ...practice(), ...JSON.parse(String(init.body)) };
        return json({ practice: saved, map: mapData([], [saved]) });
      },
    });
    fireEvent.change(await answer(), { target: { value: 'Draft through real Terms review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await screen.findByRole('link', { name: 'Review terms' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Review terms' }));
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect((await answer()).value).toBe('Draft through real Terms review');
    expect(router.state.location.pathname).toBe('/reflection');
    expect(router.state.location.state.practiceId).toBe('p');
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(writes().filter((call) => String(call[0]).includes('/practices/'))).toHaveLength(2);
  });
  test('rapid source navigation ignores late loading response and never sends another practice answer', async () => {
    const pending = deferred<Response>();
    let reads = 0;
    const data = mapData([], [practice('a'), practice('b')]);
    const { router, writes } = mount({
      source: 'a',
      initial: data,
      read: () => (++reads === 1 ? pending.promise : json(data)),
    });
    await screen.findByText('Loading practice...');
    await act(() => router.navigate('/reflection', { state: { practiceId: 'b' } }));
    fireEvent.change(await answer(), { target: { value: 'Answer for B' } });
    await act(() => pending.resolve(json(data)));
    expect((screen.getByLabelText(reflectionPrompt) as HTMLTextAreaElement).value).toBe(
      'Answer for B',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(String(writes()[0][0])).toContain('/practices/b');
  });
  test('server 402 hides Reflection and real access recheck restores its same-owner draft', async () => {
    let denied = false;
    const { session } = mount({
      read: () =>
        denied
          ? json({ detail: 'Premium is required to access My Map.' }, 402)
          : json(mapData([], [practice()])),
      write: () => {
        denied = true;
        return json({ detail: 'Premium is required to access My Map.' }, 402);
      },
    });
    fireEvent.change(await answer(), { target: { value: 'Draft during access change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await screen.findByRole('button', { name: 'Check access again' });
    expect(screen.queryByRole('dialog')).toBeNull();
    denied = false;
    await act(() => session.reload({ force: true }));
    expect((await answer()).value).toBe('Draft during access change');
  });
  test('browser Back closes Reflection without a write and restores the selected Map details', async () => {
    const { router, writes } = mount({ path: '/map' });
    fireEvent.change(await completeMapLink(), { target: { value: 'Not submitted' } });
    await act(() => router.navigate(-1));
    await screen.findByRole('complementary', { name: 'Overall details' });
    expect(router.state.location.pathname).toBe('/map');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  test('existing-token email activation recovery preserves source/answer without storing answers in auth state', async () => {
    let verified = false,
      gate = false;
    const { router } = mount({
      read: () =>
        gate && !verified
          ? json({ detail: 'Please verify your email before logging in.' }, 403)
          : json(mapData([], [practice()])),
      write: () => {
        gate = true;
        return json({ detail: 'Please verify your email before logging in.' }, 403);
      },
      overrides: {
        '/users/me/account': () => json({ ...account, is_email_verified: verified }),
        '/auth/email-verification/confirm': () => {
          verified = true;
          return json({ verified: true, detail: 'Email activated. You can now log in.' });
        },
      },
    });
    fireEvent.change(await answer(), { target: { value: 'Draft through activation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    fireEvent.click(
      await screen.findByRole('link', { name: 'Activate account / enter email PIN' }),
    );
    await screen.findByRole('form', { name: 'Activate your account' });
    expect(router.state.location.state.practiceId).toBe('p');
    expect(Object.values(router.state.location.state)).not.toContain('Draft through activation');
    fireEvent.change(screen.getByLabelText('Activation PIN'), { target: { value: '001234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect((await answer()).value).toBe('Draft through activation');
    expect(router.state.location.pathname).toBe('/reflection');
    expect(router.state.location.state.practiceId).toBe('p');
  });
});

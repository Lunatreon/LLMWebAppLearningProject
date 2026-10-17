import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import App from '../App';
import { previewSession } from './previewSession';
import type { ShellSession } from '../types/navigation';
import { setMobileViewport, setViewportWidth } from './setup';
import FeaturePlaceholderPage from './fixtures/FeaturePlaceholderPage';

function mount(path = '/chat', session?: ShellSession) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <App
            session={session ?? previewSession}
            feedbackElement={<FeaturePlaceholderPage feature="feedback" />}
            accountElement={<FeaturePlaceholderPage feature="account" />}
            journalElement={<FeaturePlaceholderPage feature="journal" />}
            mapElement={<FeaturePlaceholderPage feature="map" />}
            reflectionElement={<FeaturePlaceholderPage feature="reflection" />}
            chatElement={<FeaturePlaceholderPage feature="chat" />}
          />
        ),
      },
    ],
    { initialEntries: [path] },
  );
  const result = render(<RouterProvider router={router} />);
  return { router, ...result };
}

describe('shared React shell', () => {
  test.each([
    { width: 1440, drawer: false },
    { width: 768, drawer: true },
    { width: 390, drawer: true },
  ])(
    'navigation drawer follows the original breakpoint at $width px',
    async ({ width, drawer }) => {
      setViewportWidth(width);
      mount('/chat');
      const sidebar = document.getElementById('sidebar')!;
      expect(sidebar.getAttribute('aria-hidden')).toBe(drawer ? 'true' : 'false');
      if (drawer) {
        const user = userEvent.setup();
        const opener = screen.getByRole('button', { name: 'Open conversations' });
        await user.click(opener);
        expect(sidebar.getAttribute('aria-hidden')).toBe('false');
        await user.keyboard('{Escape}');
        expect(sidebar.getAttribute('aria-hidden')).toBe('true');
        expect(document.activeElement).toBe(opener);
      }
    },
  );
  test.each(['chat', 'map', 'journal', 'reflection', 'account', 'feedback'])(
    'opens /%s directly with a placeholder',
    (feature) => {
      const { router } = mount(`/${feature}`);
      expect(router.state.location.pathname).toBe(`/${feature}`);
      expect(screen.getByRole('heading', { name: 'Shared shell active' })).toBeDefined();
      expect(
        screen.getByText(`This ${feature} page is not migrated yet.`, { exact: false }),
      ).toBeDefined();
      expect(screen.getByRole('complementary', { name: 'Chat navigation' })).toBeDefined();
      expect(screen.getByText('No account signed in')).toBeDefined();
      expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    },
  );

  test.each(['/', '/index.html', '/chat.html'])(
    'maps the legacy entry %s and preserves remaining query/hash',
    async (path) => {
      const { router } = mount(
        `${path}?view=journal&api_base=http%3A%2F%2F127.0.0.1%3A8001%2Fapi%2Fv1#compare`,
      );
      await waitFor(() => expect(router.state.location.pathname).toBe('/journal'));
      expect(new URLSearchParams(router.state.location.search).get('api_base')).toBe(
        'http://127.0.0.1:8001/api/v1',
      );
      expect(new URLSearchParams(router.state.location.search).has('view')).toBe(false);
      expect(router.state.location.hash).toBe('#compare');
    },
  );

  test('root defaults to chat and an unknown route has a working return link', async () => {
    const user = userEvent.setup();
    const { router } = mount('/?view=unknown');
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    await act(() => router.navigate('/missing'));
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'Return to FeelY' }));
    expect(router.state.location.pathname).toBe('/chat');
  });

  test('switches workspace tabs and context while keeping Journal outside the main tabs', async () => {
    const user = userEvent.setup();
    const { router } = mount();
    const tablist = screen.getByRole('tablist', { name: 'Workspace view' });
    expect(within(tablist).getAllByRole('tab').length).toBe(2);
    expect(within(tablist).queryByText('Journal')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(screen.getByRole('tab', { name: 'Map' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('My Map is a Premium space')).toBeDefined();
    expect(screen.queryByRole('navigation', { name: 'Chats' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Journal' }));
    expect(router.state.location.pathname).toBe('/journal');
    expect(screen.getByRole('button', { name: 'Journal' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Journal' }).classList.contains('active')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Your journal' })).toBeDefined();
    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(router.state.location.pathname).toBe('/chat');
    expect(screen.getByRole('navigation', { name: 'Chats' })).toBeDefined();
    expect(screen.getByText('Conversations are not loaded in this preview.')).toBeDefined();
  });

  test('Arrow keys select and focus Chat/Map tabs with roving tabindex', async () => {
    const user = userEvent.setup();
    const { router } = mount();
    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    await user.keyboard('{ArrowRight}');
    const map = screen.getByRole('tab', { name: 'Map' });
    expect(router.state.location.pathname).toBe('/map');
    expect(document.activeElement).toBe(map);
    expect(map.tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Chat' }).tabIndex).toBe(-1);
    await user.keyboard('{ArrowLeft}');
    expect(router.state.location.pathname).toBe('/chat');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Chat' }));
  });

  test('Back and Forward restore active routes and document titles', async () => {
    const user = userEvent.setup();
    const { router } = mount();
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    await user.click(screen.getByRole('button', { name: 'Journal' }));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/map');
    expect(screen.getByRole('tab', { name: 'Map' }).getAttribute('aria-selected')).toBe('true');
    expect(document.title).toBe('My Map | FeelY');
    await act(() => router.navigate(1));
    expect(router.state.location.pathname).toBe('/journal');
    expect(document.title).toBe('Journal | FeelY');
  });

  test('account and feedback preserve the current workspace and offer a return route', async () => {
    const user = userEvent.setup();
    const { router } = mount('/journal');
    await user.click(screen.getByRole('button', { name: 'Account settings' }));
    expect(router.state.location.pathname).toBe('/account');
    expect(
      screen.getByRole('button', { name: 'Account settings' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('heading', { name: 'Your journal' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Share test feedback' }));
    expect(router.state.location.pathname).toBe('/feedback');
    expect(
      screen.getByRole('button', { name: 'Share test feedback' }).getAttribute('aria-current'),
    ).toBe('page');
    await user.click(screen.getByRole('link', { name: 'Return to workspace' }));
    expect(router.state.location.pathname).toBe('/journal');
  });

  test('active tab clicks avoid duplicate history entries and keep query overrides', async () => {
    const user = userEvent.setup();
    const { router } = mount('/chat?api_base=http%3A%2F%2F127.0.0.1%3A8001%2Fapi%2Fv1');
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    expect(new URLSearchParams(router.state.location.search).get('api_base')).toBe(
      'http://127.0.0.1:8001/api/v1',
    );
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/chat');
  });

  test('reflection navigation remains attached to Map', async () => {
    const user = userEvent.setup();
    const { router } = mount('/map');
    await user.click(screen.getByRole('link', { name: 'Preview reflection navigation' }));
    expect(router.state.location.pathname).toBe('/reflection');
    expect(screen.getByRole('tab', { name: 'Map' }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('link', { name: 'Return to workspace' }));
    expect(router.state.location.pathname).toBe('/map');
  });

  test('mobile drawer closes on navigation, backdrop, close button and Escape with focus restored', async () => {
    setMobileViewport(true);
    const user = userEvent.setup();
    const { router } = mount();
    const sidebar = screen.getByRole('complementary', { hidden: true });
    expect(sidebar.hasAttribute('inert')).toBe(true);
    const menu = screen.getByRole('button', { name: 'Open conversations' });
    await user.click(menu);
    expect(sidebar.classList.contains('open')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close navigation' }));
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(sidebar.classList.contains('open')).toBe(false);
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(menu);
    for (const dismissal of ['backdrop', 'close', 'escape']) {
      await user.click(menu);
      if (dismissal === 'backdrop')
        await user.click(screen.getByRole('button', { name: 'Close chat navigation' }));
      if (dismissal === 'close')
        await user.click(screen.getByRole('button', { name: 'Close navigation' }));
      if (dismissal === 'escape') await user.keyboard('{Escape}');
      expect(sidebar.classList.contains('open')).toBe(false);
      expect(menu.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(menu);
    }
  });

  test('mobile drawer keeps keyboard focus inside and resets after resizing to desktop', async () => {
    setMobileViewport(true);
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Open conversations' }));
    const account = screen.getByRole('button', { name: 'Account settings' });
    account.focus();
    await user.tab();
    const brand = screen.getByRole('link', { name: 'FeelY chat' });
    expect(document.activeElement).toBe(brand);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(account);
    await act(() => setMobileViewport(false));
    expect(screen.getByRole('complementary').hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('tabpanel').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(brand);
    await act(() => setMobileViewport(true));
    expect(screen.getByRole('complementary', { hidden: true }).classList.contains('open')).toBe(
      false,
    );
  });

  test('Back closes an open mobile drawer without stale active state', async () => {
    setMobileViewport(true);
    const user = userEvent.setup();
    const { router } = mount();
    await user.click(screen.getByRole('button', { name: 'Open conversations' }));
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    await user.click(screen.getByRole('button', { name: 'Open conversations' }));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/chat');
    expect(screen.getByRole('complementary', { hidden: true }).classList.contains('open')).toBe(
      false,
    );
    await act(() => router.navigate(1));
    expect(router.state.location.pathname).toBe('/map');
    expect(screen.getByRole('complementary', { hidden: true }).classList.contains('open')).toBe(
      false,
    );
  });

  test('appearance restores the legacy preference, updates metadata and survives route transitions without auth/API effects', async () => {
    const user = userEvent.setup();
    localStorage.setItem('feely_theme', 'light');
    localStorage.setItem('feely_token', 'test-sentinel');
    const fetch = vi.fn(() => {
      throw new Error('No API request should occur');
    });
    vi.stubGlobal('fetch', fetch);
    mount();
    const toggle = screen.getByRole('switch', { name: 'Use dark appearance' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.head.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#fff4f7',
    );
    await user.click(toggle);
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    expect(localStorage.getItem('feely_theme')).toBe('dark');
    expect(localStorage.getItem('feely_token')).toBe('test-sentinel');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(
      screen.getByRole('switch', { name: 'Use light appearance' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#100f13',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('blocked storage leaves appearance controls usable', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    mount();
    await user.click(screen.getByRole('switch', { name: 'Use light appearance' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('switch', { name: 'Use dark appearance' })).toBeDefined();
  });

  test('viewport height follows visual viewport resize and cleans up on unmount', async () => {
    const viewport = Object.assign(new EventTarget(), { height: 620 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    const { unmount } = mount();
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('620px');
    await act(() => {
      viewport.height = 410;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('410px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('');
  });

  test('layout capability inputs control feedback and premium sidebar structure without loading data', async () => {
    const user = userEvent.setup();
    mount('/map', {
      ...previewSession,
      feedbackEnabled: false,
      mapAccess: true,
      journalAccess: true,
    });
    expect(screen.queryByRole('button', { name: 'Share test feedback' })).toBeNull();
    expect(screen.queryByText('My Map is a Premium space')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Map topics' })).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Create topic' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Journal' }));
    expect(screen.getByRole('navigation', { name: 'Journal entries' })).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Previous day' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

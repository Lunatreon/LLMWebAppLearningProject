import { lazy, useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { DialogFrame, useDialogControls } from '../components/shared/DialogFrame';
import ViewBoundary from '../components/shared/ViewBoundary';
import { deferred } from './backend';
import { json, mockBackend } from './backend';
import { SessionController } from '../services/sessionController';
import { renderApp } from './renderApp';

function Dialog({ empty = false, hidden = false, onClose = () => {} }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { controls, bind } = useDialogControls();
  return (
    <DialogFrame
      label="Keyboard test"
      controls={controls}
      focus={heading}
      hidden={hidden}
      onClose={onClose}
    >
      <h2 ref={heading} tabIndex={-1}>
        Heading
      </h2>
      {!empty && (
        <>
          <button ref={bind} type="button">
            First
          </button>
          <button ref={bind} type="button" disabled>
            Unavailable
          </button>
          <input ref={bind} aria-label="Last" />
        </>
      )}
    </DialogFrame>
  );
}

describe('shared modal keyboard and focus', () => {
  test('Shift+Tab from the initial heading stays inside the dialog at the last control', async () => {
    render(<Dialog />);
    expect(document.activeElement).toBe(screen.getByRole('heading'));
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Last'));
  });
  test('Tab from the initial heading enters the first control and wraps at both boundaries', async () => {
    render(<Dialog />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Last'));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Last'));
  });
  test('a modal without enabled controls keeps keyboard focus inside its frame', async () => {
    render(<Dialog empty />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });
  test('closing restores the opener and Escape invokes the explicit close operation', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const close = vi.fn();
    const view = render(<Dialog onClose={close} />);
    fireEvent.keyDown(screen.getByRole('heading'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
  test('a hidden Terms-retained modal does not steal focus', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const view = render(<Dialog hidden />);
    expect(document.activeElement).toBe(opener);
    view.unmount();
    opener.remove();
  });
});

describe('lazy view recovery', () => {
  test('pending lazy content exposes a status then displays the resolved view', async () => {
    const loading = deferred<{ default: () => React.JSX.Element }>();
    const Page = lazy(() => loading.promise);
    render(
      <ViewBoundary>
        <Page />
      </ViewBoundary>,
    );
    expect(screen.getByRole('status').textContent).toBe('Loading...');
    await act(async () => loading.resolve({ default: () => <h2>Loaded feature</h2> }));
    expect(screen.getByRole('heading').textContent).toBe('Loaded feature');
    expect(screen.queryByRole('status')).toBeNull();
  });
  test('failed lazy content offers recovery and switching routes can show a working view', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Page = lazy(async () => {
      throw new Error('Synthetic chunk failure');
    });
    const view = render(
      <ViewBoundary resetKey="/chat">
        <Page />
      </ViewBoundary>,
    );
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeDefined();
    view.rerender(
      <ViewBoundary resetKey="/map">
        <h2>Working Map</h2>
      </ViewBoundary>,
    );
    await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Working Map'));
  });
  test('dialog load failure has a close action instead of trapping the inert workspace', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const close = vi.fn();
    const Form = lazy(async () => {
      throw new Error('Synthetic dialog load failure');
    });
    render(
      <ViewBoundary onClose={close}>
        <Form />
      </ViewBoundary>,
    );
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('form error accessibility', () => {
  test('a rejected sign-in describes the visible backend error from both credential fields', async () => {
    mockBackend({ '/auth/login': () => json({ detail: 'Please verify your email' }, 403) });
    const session = new SessionController('http://127.0.0.1:8000/api/v1');
    const view = renderApp({ session, path: '/login' });
    const email = await screen.findByLabelText('Email');
    const password = screen.getByLabelText('Password');
    fireEvent.change(email, { target: { value: 'synthetic@example.com' } });
    fireEvent.change(password, { target: { value: 'synthetic-password' } });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Login' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await screen.findByText('Please verify your email');
    for (const field of [email, password]) {
      const descriptions = field
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      expect(descriptions).toContain('Please verify your email');
    }
    view.unmount();
  });
});

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { expect, test, vi } from 'vitest';

test('admin navigation, category editing, creation, deletion and user actions work', async () => {
  document.documentElement.innerHTML = readFileSync(resolve('public/admin.html'), 'utf8');
  const styles = document.createElement('style');
  styles.textContent = readFileSync(resolve('public/admin.css'), 'utf8');
  document.head.append(styles);
  expect(getComputedStyle(document.querySelector('.admin-form')!).display).toBe('grid');
  expect(getComputedStyle(document.querySelector('.admin-user-layout')!).display).toBe('grid');
  expect(getComputedStyle(document.querySelector('.admin-check')!).display).toBe('flex');
  expect(
    getComputedStyle(
      document.querySelector('.admin-row-actions') ||
        document.querySelector('.admin-header-actions')!,
    ).gap,
  ).toBe('12px');
  expect(getComputedStyle(document.querySelector('.admin-form-actions')!).justifyContent).toBe(
    'flex-end',
  );
  const deleteStyle = getComputedStyle(document.querySelector('#delete-user')!);
  expect(deleteStyle.color).toBe('rgb(143, 41, 57)');
  expect(deleteStyle.paddingRight).toBe('16px');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false;
    },
  });
  localStorage.setItem('feely_admin_token', 'test-token');
  const user = {
    id: 1,
    username: 'tester',
    email: 'test@example.com',
    display_name: 'Test',
    role: 'member',
    is_active: true,
    is_email_verified: false,
    premium: false,
    stripe_subscription: false,
    subscription_plan: 'free',
    subscription_status: 'none',
  };
  let users = [user];
  let categories = [
    {
      kind: 'entry',
      key: 'task',
      label: 'Task',
      description: 'A task',
      active: true,
      llm_enabled: true,
      supports_completion: true,
      position: 0,
    },
  ];
  const defaults = {
    chat_provider: 'mock',
    chat_model: '',
    topic_provider: 'local',
    topic_model: '',
    feedback_enabled: false,
    password_reset_enabled: false,
    premium_features_enabled: false,
    rate_limit_llm_free_user_per_day: 10,
    rate_limit_llm_user_per_day: 400,
  };
  let preferences = {
    revision: 0,
    overridden: false,
    values: { ...defaults },
    defaults,
    providers: { mock: true, local: true, ollama: true, openai: false, anthropic: false },
    default_models: { ollama: { chat: 'installed-model', topic: 'installed-model' } },
    email_delivery_configured: false,
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, location.origin).pathname;
    if (path.endsWith('/admin/settings')) {
      if (init?.method === 'PUT') {
        const { expected_revision, ...values } = JSON.parse(String(init.body));
        expect(expected_revision).toBe(preferences.revision);
        preferences = {
          ...preferences,
          revision: preferences.revision + 1,
          overridden: true,
          values,
        };
      } else if (init?.method === 'DELETE')
        preferences = {
          ...preferences,
          revision: preferences.revision + 1,
          overridden: false,
          values: { ...defaults },
        };
      return Response.json(preferences);
    }
    if (path.endsWith('/admin/status')) return Response.json({ username: 'root' });
    if (path.endsWith('/admin/users')) return Response.json(users);
    if (path.endsWith('/admin/prompts')) return Response.json({ prompts: [] });
    if (path.endsWith('/admin/feedback')) return Response.json([]);
    if (path.endsWith('/admin/map/categories')) return Response.json(categories);
    if (path.includes('/admin/map/categories/')) {
      const key = path.split('/').at(-1)!;
      if (init?.method === 'DELETE') {
        categories = categories.filter((row) => row.key !== key);
        return new Response(null, { status: 204 });
      }
      const body = JSON.parse(String(init?.body));
      const row = { kind: 'entry', key, ...body };
      categories = [...categories.filter((row) => row.key !== key), row];
      return Response.json(row);
    }
    if (path.endsWith('/admin/users/1')) {
      if (init?.method === 'DELETE') {
        users = [];
        return new Response(null, { status: 204 });
      }
      Object.assign(user, JSON.parse(String(init?.body)));
      return Response.json(user);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  window.eval(`(() => { ${readFileSync(resolve('public/admin.js'), 'utf8')} })()`);
  await waitFor(() =>
    expect(document.querySelector('#admin-status')?.textContent).toContain('Administration ready'),
  );
  expect(document.querySelector('#section-users')?.classList.contains('hidden')).toBe(false);
  fireEvent.click(within(document.body).getByRole('button', { name: 'Map categories' }));
  expect(document.querySelector('#section-users')?.classList.contains('hidden')).toBe(true);
  fireEvent.click(within(document.body).getByRole('button', { name: 'Edit Task' }));
  const dialog = document.querySelector<HTMLDialogElement>('#map-category-dialog')!;
  const form = document.querySelector<HTMLFormElement>('#map-category-form')!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  expect(dialog.open).toBe(true);
  expect(field('label').value).toBe('Task');
  expect(field('description').value).toBe('A task');
  expect(field('key').readOnly).toBe(true);
  fireEvent.change(field('label'), { target: { value: 'My tasks' } });
  fireEvent.submit(form);
  await waitFor(() => expect(dialog.open).toBe(false));
  expect(within(document.body).getByRole('button', { name: 'Edit My tasks' })).toBeTruthy();
  fireEvent.click(within(document.body).getByRole('button', { name: '+ Add category' }));
  expect(field('key').readOnly).toBe(false);
  expect(field('label').value).toBe('');
  fireEvent.change(field('key'), { target: { value: 'experiment' } });
  fireEvent.change(field('label'), { target: { value: 'Experiment' } });
  fireEvent.submit(form);
  await waitFor(() => expect(dialog.open).toBe(false));
  fireEvent.click(within(document.body).getByRole('button', { name: 'Delete Experiment' }));
  const confirm = document.querySelector<HTMLDialogElement>('#admin-confirm-dialog')!;
  expect(confirm.open).toBe(true);
  fireEvent.change(document.querySelector('#admin-confirm-input')!, {
    target: { value: 'experiment' },
  });
  fireEvent.submit(document.querySelector('#admin-confirm-form')!);
  await waitFor(() => expect(categories).toHaveLength(1));
  fireEvent.click(within(document.body).getByRole('button', { name: 'Users' }));
  fireEvent.click(document.querySelector('#admin-user-list button')!);
  const userForm = document.querySelector<HTMLFormElement>('#admin-user-form')!;
  expect(userForm.lastElementChild?.classList.contains('admin-form-actions')).toBe(true);
  fireEvent.change(document.querySelector('#admin-user-display-name')!, {
    target: { value: 'Updated' },
  });
  fireEvent.submit(userForm);
  await waitFor(() =>
    expect(document.querySelector('#user-save-status')?.textContent).toBe('Changes saved.'),
  );
  fireEvent.click(document.querySelector('#delete-user')!);
  expect(confirm.open).toBe(true);
  fireEvent.click(document.querySelector('#admin-confirm-cancel')!);
  expect(users).toHaveLength(1);
  fireEvent.click(document.querySelector('#delete-user')!);
  fireEvent.change(document.querySelector('#admin-confirm-input')!, {
    target: { value: 'tester' },
  });
  fireEvent.submit(document.querySelector('#admin-confirm-form')!);
  await waitFor(() =>
    expect(document.querySelector('#admin-user-editor')?.classList.contains('hidden')).toBe(true),
  );
  expect(users).toHaveLength(0);
  fireEvent.click(within(document.body).getByRole('button', { name: 'App settings' }));
  await waitFor(() =>
    expect(document.querySelector('#app-settings-status')?.textContent).toBe(
      'Using deployment defaults.',
    ),
  );
  const provider = document.querySelector<HTMLSelectElement>('[name="chat_provider"]')!;
  const model = document.querySelector<HTMLInputElement>('[name="chat_model"]')!;
  expect(model.disabled).toBe(true);
  expect(provider.querySelector<HTMLOptionElement>('option[value="openai"]')!.disabled).toBe(true);
  fireEvent.change(provider, { target: { value: 'ollama' } });
  expect(model.disabled).toBe(false);
  expect(model.value).toBe('installed-model');
  fireEvent.change(model, { target: { value: 'custom-model' } });
  fireEvent.click(document.querySelector('[name="feedback_enabled"]')!);
  fireEvent.submit(document.querySelector('#app-settings-form')!);
  await waitFor(() => expect(preferences.revision).toBe(1));
  await waitFor(() =>
    expect(document.querySelector('#app-settings-status')?.textContent).toContain('Settings saved'),
  );
  expect(preferences.values.chat_model).toBe('custom-model');
  expect(preferences.values.feedback_enabled).toBe(true);
  fireEvent.click(document.querySelector('#reset-app-settings')!);
  fireEvent.change(document.querySelector('#admin-confirm-input')!, {
    target: { value: 'RESET_SETTINGS' },
  });
  fireEvent.submit(document.querySelector('#admin-confirm-form')!);
  await waitFor(() => expect(preferences.overridden).toBe(false));
  await waitFor(() => expect(model.disabled).toBe(true));
});

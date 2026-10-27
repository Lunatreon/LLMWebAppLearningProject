function resolveApiBase() {
  return (
    document.querySelector('meta[name="feely-api-base"]')?.content.trim().replace(/\/$/, '') ||
    `${window.location.origin}/api/v1`
  );
}

const API_BASE = resolveApiBase();
let adminToken = localStorage.getItem('feely_admin_token');
const state = { users: [], selectedUserId: null };
const loginView = document.querySelector('#admin-login-view');
const adminApp = document.querySelector('#admin-app');
const loginForm = document.querySelector('#admin-login-form');
const loginUsername = document.querySelector('#admin-login-username');
const loginPassword = document.querySelector('#admin-login-password');
const loginError = document.querySelector('#admin-login-error');
const statusLine = document.querySelector('#admin-status');
const userList = document.querySelector('#admin-user-list');
const userEditor = document.querySelector('#admin-user-editor');
const userTitle = document.querySelector('#selected-user-title');
const userForm = document.querySelector('#admin-user-form');
const userEmail = document.querySelector('#admin-user-email');
const userUsername = document.querySelector('#admin-user-username');
const userDisplayName = document.querySelector('#admin-user-display-name');
const userActive = document.querySelector('#admin-user-active');
const userRole = document.querySelector('#admin-user-role');
const userVerified = document.querySelector('#admin-user-verified');
const passwordForm = document.querySelector('#admin-password-form');
const newPassword = document.querySelector('#admin-new-password');
const subscriptionState = document.querySelector('#admin-subscription-state');
const removeSubscription = document.querySelector('#remove-subscription');

let mapCategoryRows = [];
const categoryDialog = document.querySelector('#map-category-dialog');
const mapCategoryForm = document.querySelector('#map-category-form');
const categoryField = (name) => mapCategoryForm.elements.namedItem(name);
let categorySaving = false;

function categoryMessage(message, error = false) {
  const status = document.querySelector('#map-category-status');
  status.textContent = message;
  status.classList.toggle('is-error', error);
}
async function loadMapCategories() {
  const token = adminToken;
  const rows = await api('/admin/map/categories', { headers: authHeaders() });
  if (adminToken !== token) return;
  mapCategoryRows = rows;
  renderMapCategories();
}
function renderMapCategories() {
  const list = document.querySelector('#map-category-list');
  const search = document.querySelector('#map-category-search').value.trim().toLowerCase();
  const kind = document.querySelector('#map-category-filter').value;
  const rows = mapCategoryRows.filter(
    (row) =>
      (!kind || row.kind === kind) &&
      `${row.label} ${row.key} ${row.description}`.toLowerCase().includes(search),
  );
  list.replaceChildren();
  document.querySelector('#map-category-count').textContent = `${rows.length} categories`;
  for (const row of rows) {
    const tr = document.createElement('tr');
    const title = document.createElement('td');
    const name = document.createElement('strong');
    name.textContent = row.label;
    const key = document.createElement('small');
    key.textContent = row.key;
    title.append(name, key);
    tr.append(title);
    for (const text of [
      row.kind === 'entry' ? 'Entry' : 'Topic',
      row.active ? 'Active' : 'Disabled',
      row.llm_enabled ? 'Allowed' : 'Off',
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    const actions = document.createElement('td');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary-button';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit ${row.label}`);
    edit.addEventListener('click', () => openCategory(row));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'admin-text-danger';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete ${row.label}`);
    const system =
      (row.kind === 'topic' && row.key === 'other') ||
      (row.kind === 'entry' && row.key === 'merged_topic');
    remove.disabled = system;
    if (system) remove.title = 'Required system category';
    remove.addEventListener('click', async () => {
      if (
        !(await confirmAction(
          `Delete the category ?${row.label}?? Existing content is never deleted. If this category is in use, disable it in the editor instead.`,
          row.key,
          'Delete category',
        ))
      )
        return;
      remove.disabled = true;
      try {
        await api(
          `/admin/map/categories/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.key)}`,
          { method: 'DELETE', headers: authHeaders() },
        );
        await loadMapCategories();
        categoryMessage('Category deleted.');
      } catch (error) {
        categoryMessage(error.message, true);
      } finally {
        remove.disabled = false;
      }
    });
    const group = document.createElement('div');
    group.className = 'admin-row-actions';
    group.append(edit, remove);
    actions.append(group);
    tr.append(actions);
    list.append(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr'),
      td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'admin-empty';
    td.textContent = 'No categories found.';
    tr.append(td);
    list.append(tr);
  }
}
function openCategory(row) {
  mapCategoryForm.reset();
  document.querySelector('#map-category-error').textContent = '';
  document.querySelector('#map-category-title').textContent = row
    ? `Edit ${row.label}`
    : 'Add category';
  for (const name of ['active', 'llm_enabled']) categoryField(name).disabled = false;
  categoryField('key').readOnly = Boolean(row);
  categoryField('kind').disabled = Boolean(row);
  if (row) {
    for (const name of ['kind', 'key', 'label', 'description', 'position'])
      categoryField(name).value = row[name];
    for (const name of ['active', 'llm_enabled', 'supports_completion'])
      categoryField(name).checked = row[name];
  }
  const other = row?.kind === 'topic' && row.key === 'other';
  const merged = row?.kind === 'entry' && row.key === 'merged_topic';
  categoryField('active').disabled = other || merged;
  categoryField('llm_enabled').disabled = other || merged;
  document.querySelector('#map-category-system-note').textContent = other
    ? 'Required fallback category. Availability and AI access are fixed.'
    : merged
      ? 'Required provenance category. AI suggestions stay off.'
      : '';
  categoryDialog.showModal();
  categoryField(row ? 'label' : 'kind').focus();
}
document.querySelector('#add-map-category').addEventListener('click', () => openCategory(null));
for (const id of ['close-map-category', 'cancel-map-category'])
  document.querySelector(`#${id}`).addEventListener('click', () => {
    if (!categorySaving) categoryDialog.close();
  });
categoryDialog.addEventListener('cancel', (event) => {
  if (categorySaving) event.preventDefault();
});
document.querySelector('#map-category-search').addEventListener('input', renderMapCategories);
document.querySelector('#map-category-filter').addEventListener('change', renderMapCategories);
mapCategoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (categorySaving) return;
  categorySaving = true;
  const button = mapCategoryForm.querySelector('button[type="submit"]');
  button.disabled = true;
  document.querySelector('#map-category-error').textContent = '';
  try {
    const body = {
      label: categoryField('label').value.trim(),
      description: categoryField('description').value,
      position: Number(categoryField('position').value),
    };
    for (const name of ['active', 'llm_enabled', 'supports_completion'])
      body[name] = categoryField(name).checked;
    const kind = categoryField('kind').value,
      key = categoryField('key').value;
    if (
      !categoryField('key').readOnly &&
      mapCategoryRows.some((row) => row.kind === kind && row.key === key)
    ) {
      throw new Error(
        'This key already exists for this type. Edit the existing category or choose another key.',
      );
    }
    await api(`/admin/map/categories/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    await loadMapCategories();
    categoryDialog.close();
    categoryMessage('Category saved. Map loads and AI calls use the updated settings.');
  } catch (error) {
    document.querySelector('#map-category-error').textContent = error.message;
  } finally {
    categorySaving = false;
    button.disabled = false;
  }
});

let appSettingsSnapshot = null;
let appSettingsLoading = false;
const appSettingsForm = document.querySelector('#app-settings-form');
const settingsField = (name) => appSettingsForm.elements.namedItem(name);
const settingFlags = ['feedback_enabled', 'password_reset_enabled', 'premium_features_enabled'];
const settingLimits = ['rate_limit_llm_free_user_per_day', 'rate_limit_llm_user_per_day'];
function settingsMessage(message, error = false) {
  const status = document.querySelector('#app-settings-status');
  status.textContent = message;
  status.classList.toggle('is-error', error);
}
function settingsBusy(busy) {
  document.querySelector('#app-settings-fields').disabled = busy;
  for (const id of ['save-app-settings', 'reset-app-settings'])
    document.querySelector(`#${id}`).disabled = busy;
  document.querySelector('#reload-app-settings').disabled = busy;
}
function populateAppSettings(snapshot) {
  appSettingsSnapshot = snapshot;
  const labels = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    ollama: 'Ollama',
    local: 'Local demo',
    mock: 'Mock demo',
  };
  for (const role of ['chat', 'topic']) {
    const select = settingsField(`${role}_provider`);
    select.replaceChildren();
    for (const provider of Object.keys(labels)) {
      const available = snapshot.providers[provider];
      const option = new Option(
        labels[provider] + (available ? '' : ' ? credentials missing'),
        provider,
      );
      option.disabled = !available;
      select.append(option);
    }
    select.value = snapshot.values[`${role}_provider`];
    settingsField(`${role}_model`).value = snapshot.values[`${role}_model`];
    updateModelField(role, false);
  }
  for (const name of settingFlags) settingsField(name).checked = snapshot.values[name];
  for (const name of settingLimits) settingsField(name).value = snapshot.values[name];
  settingsBusy(false);
}
function updateModelField(role, changed) {
  const provider = settingsField(`${role}_provider`).value;
  const input = settingsField(`${role}_model`);
  input.disabled = ['mock', 'local'].includes(provider);
  input.required = !input.disabled;
  if (changed) input.value = appSettingsSnapshot?.default_models[provider]?.[role] || '';
  input.placeholder = input.disabled ? 'No AI model used' : 'Exact model identifier';
}
async function loadAppSettings() {
  if (appSettingsLoading) return;
  appSettingsLoading = true;
  settingsBusy(true);
  settingsMessage('Loading app settings?');
  try {
    const snapshot = await api('/admin/settings', { headers: authHeaders() });
    populateAppSettings(snapshot);
    settingsMessage(
      snapshot.overridden ? 'Saved settings are active.' : 'Using deployment defaults.',
    );
  } catch (error) {
    settingsMessage(error.message, true);
    document.querySelector('#reload-app-settings').disabled = false;
  } finally {
    appSettingsLoading = false;
  }
}
for (const role of ['chat', 'topic'])
  settingsField(`${role}_provider`).addEventListener('change', () => updateModelField(role, true));
document.querySelector('#reload-app-settings').addEventListener('click', loadAppSettings);
appSettingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!appSettingsSnapshot || appSettingsLoading) return;
  const body = { expected_revision: appSettingsSnapshot.revision };
  for (const role of ['chat', 'topic'])
    for (const key of ['provider', 'model'])
      body[`${role}_${key}`] = settingsField(`${role}_${key}`).value;
  for (const name of settingFlags) body[name] = settingsField(name).checked;
  for (const name of settingLimits) body[name] = Number(settingsField(name).value);
  appSettingsLoading = true;
  settingsBusy(true);
  settingsMessage('Saving?');
  try {
    const snapshot = await api('/admin/settings', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    populateAppSettings(snapshot);
    settingsMessage('Settings saved. New requests use these values.');
  } catch (error) {
    settingsMessage(error.message, true);
  } finally {
    appSettingsLoading = false;
    settingsBusy(false);
  }
});
document.querySelector('#reset-app-settings').addEventListener('click', async () => {
  if (!appSettingsSnapshot || appSettingsLoading) return;
  if (
    !(await confirmAction(
      'Restore model, feature and limit settings from your deployment configuration?',
      'RESET_SETTINGS',
      'Use deployment defaults',
    ))
  )
    return;
  appSettingsLoading = true;
  settingsBusy(true);
  try {
    const snapshot = await api(
      `/admin/settings?expected_revision=${appSettingsSnapshot.revision}`,
      { method: 'DELETE', headers: authHeaders() },
    );
    populateAppSettings(snapshot);
    settingsMessage('Deployment defaults restored.');
  } catch (error) {
    settingsMessage(error.message, true);
  } finally {
    appSettingsLoading = false;
    settingsBusy(false);
  }
});

function showSection(name) {
  const valid = ['users', 'categories', 'prompts', 'feedback', 'settings'];
  if (!valid.includes(name)) name = 'users';
  for (const section of valid)
    document.querySelector(`#section-${section}`).classList.toggle('hidden', name !== section);
  document.querySelectorAll('[data-section]').forEach((button) => {
    if (button.dataset.section === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#${name}`);
  if (name === 'settings' && adminToken && !appSettingsSnapshot) void loadAppSettings();
}
document
  .querySelectorAll('[data-section]')
  .forEach((button) => button.addEventListener('click', () => showSection(button.dataset.section)));
showSection(location.hash.slice(1));

let pendingConfirmation = null;
const confirmDialog = document.querySelector('#admin-confirm-dialog');
async function confirmAction(message, value, title = 'Confirm action') {
  if (pendingConfirmation) return false;
  document.querySelector('#admin-confirm-title').textContent = title;
  document.querySelector('#admin-confirm-submit').textContent = title;
  document.querySelector('#admin-confirm-message').textContent = message;
  document.querySelector('#admin-confirm-value').textContent = value;
  const input = document.querySelector('#admin-confirm-input');
  input.value = '';
  input.setCustomValidity('');
  confirmDialog.showModal();
  input.focus();
  return new Promise((resolve) => {
    pendingConfirmation = { resolve, value };
  });
}
function finishConfirmation(confirmed) {
  const pending = pendingConfirmation;
  pendingConfirmation = null;
  confirmDialog.close();
  pending?.resolve(confirmed);
}
document
  .querySelector('#admin-confirm-cancel')
  .addEventListener('click', () => finishConfirmation(false));
confirmDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  finishConfirmation(false);
});
document
  .querySelector('#admin-confirm-input')
  .addEventListener('input', (event) => event.target.setCustomValidity(''));
document.querySelector('#admin-confirm-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#admin-confirm-input');
  if (input.value !== pendingConfirmation?.value) {
    input.setCustomValidity('Enter the exact confirmation text.');
    input.reportValidity();
    return;
  }
  finishConfirmation(true);
});

function authHeaders() {
  return { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
}
async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(payload.detail)
      ? payload.detail.map((item) => item.msg).join('; ')
      : payload.detail;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return payload;
}
function setStatus(message, error = false) {
  statusLine.textContent = message;
  statusLine.style.color = error ? '#9b3c34' : '#765c89';
}
function selectedUser() {
  return state.users.find((user) => user.id === state.selectedUserId);
}

function renderUsers() {
  userList.replaceChildren();
  const search = document.querySelector('#admin-user-search').value.trim().toLowerCase();
  const users = state.users.filter((user) =>
    `${user.username} ${user.email} ${user.display_name || ''}`.toLowerCase().includes(search),
  );
  if (!users.length) userList.textContent = 'No users found.';
  users.forEach((user) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `admin-user-card${user.id === state.selectedUserId ? ' active' : ''}`;
    const premium = user.premium ? `<i>${user.subscription_plan}</i>` : '<i>free</i>';
    button.innerHTML = `<strong></strong><span></span><div class="admin-user-badges">${premium}<i>${user.is_active ? 'active' : 'disabled'}</i></div>`;
    const roleBadge = document.createElement('i');
    roleBadge.textContent = user.role || 'member';
    button.querySelector('.admin-user-badges').append(roleBadge);
    button.querySelector('strong').textContent = user.display_name || user.username;
    button.querySelector('span').textContent = user.email;
    button.addEventListener('click', () => selectUser(user.id));
    userList.append(button);
  });
}

function selectUser(userId) {
  state.selectedUserId = userId;
  const user = selectedUser();
  if (!user) return;
  document.querySelector('#admin-user-empty').classList.add('hidden');
  userEditor.classList.remove('hidden');
  document.querySelector('#user-save-status').textContent = '';
  document.querySelector('#delete-user').disabled =
    user.username === document.querySelector('#admin-status').dataset.username;
  userTitle.textContent = `Edit ${user.display_name || user.username}`;
  userEmail.value = user.email;
  userUsername.value = user.username;
  userDisplayName.value = user.display_name || '';
  userActive.checked = user.is_active;
  userRole.value = user.role || 'member';
  userVerified.checked = user.is_email_verified;
  subscriptionState.textContent = `${user.subscription_plan} · ${user.subscription_status}${user.stripe_subscription ? ' · linked to Stripe' : ''}`;
  removeSubscription.disabled = !user.stripe_subscription && !user.premium;
  renderUsers();
}

async function loadUsers() {
  state.users = await api('/admin/users', { headers: authHeaders() });
  if (state.selectedUserId && !selectedUser()) state.selectedUserId = null;
  renderUsers();
  if (state.selectedUserId) selectUser(state.selectedUserId);
  else {
    userEditor.classList.add('hidden');
    document.querySelector('#admin-user-empty').classList.remove('hidden');
  }
}

async function loadPrompts() {
  const payload = await api('/admin/prompts', { headers: authHeaders() });
  payload.prompts.forEach((prompt) => {
    document.querySelector(`#${prompt.kind}-prompt`).value = prompt.text;
  });
}

let feedbackCursor = null;
let feedbackLoading = false;
async function loadFeedback(append = false) {
  if (feedbackLoading) return;
  feedbackLoading = true;
  const token = adminToken;
  const status = document.querySelector('#admin-feedback-status');
  const list = document.querySelector('#admin-feedback-list');
  status.textContent = 'Loading feedback...';
  try {
    const query = append && feedbackCursor ? `?before_id=${feedbackCursor}` : '';
    const entries = await api(`/admin/feedback${query}`, { headers: authHeaders() });
    if (adminToken !== token) return;
    if (!append) list.replaceChildren();
    entries.forEach((entry) => {
      const card = document.createElement('article');
      card.className = 'admin-panel';
      const heading = document.createElement('h3');
      heading.textContent = `${entry.category} - ${entry.email}`;
      const date = document.createElement('p');
      date.textContent = new Date(
        /(?:Z|[+-]\d{2}:\d{2})$/.test(entry.created_at) ? entry.created_at : `${entry.created_at}Z`,
      ).toLocaleString();
      const message = document.createElement('p');
      message.style.whiteSpace = 'pre-wrap';
      message.style.overflowWrap = 'anywhere';
      message.textContent = entry.message;
      card.append(heading, date, message);
      list.append(card);
    });
    feedbackCursor = entries.at(-1)?.id || null;
    document.querySelector('#more-feedback').classList.toggle('hidden', entries.length < 50);
    status.textContent = !append && !entries.length ? 'No feedback yet.' : '';
  } catch (error) {
    if (adminToken === token) status.textContent = error.message;
  } finally {
    feedbackLoading = false;
  }
}
document.querySelector('#refresh-feedback').addEventListener('click', () => loadFeedback());
document.querySelector('#more-feedback').addEventListener('click', () => loadFeedback(true));

document.querySelector('#admin-create-user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const created = await api('/admin/users', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    form.reset();
    await loadUsers();
    selectUser(created.id);
    setStatus(`Account created with ${created.role} access.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#admin-user-search').addEventListener('input', renderUsers);
document.querySelector('#delete-user').addEventListener('click', async () => {
  const user = selectedUser();
  if (!user) return;
  if (
    !(await confirmAction(
      `Permanently delete ${user.email} and their profile, chats, map and feedback? This cannot be undone.`,
      user.username,
      'Delete user',
    ))
  )
    return;
  const button = document.querySelector('#delete-user');
  button.disabled = true;
  try {
    await api(`/admin/users/${user.id}?confirmation=${encodeURIComponent(user.username)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    state.selectedUserId = null;
    await loadUsers();
    setStatus('User deleted.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});
userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = userForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const status = document.querySelector('#user-save-status');
  status.textContent = 'Saving...';
  try {
    const updated = await api(`/admin/users/${state.selectedUserId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({
        email: userEmail.value,
        username: userUsername.value,
        display_name: userDisplayName.value || null,
        is_active: userActive.checked,
        role: userRole.value,
        is_email_verified: userVerified.checked,
      }),
    });
    state.users = state.users.map((user) => (user.id === updated.id ? updated : user));
    selectUser(updated.id);
    status.textContent = 'Changes saved.';
    setStatus('User saved.');
  } catch (error) {
    status.textContent = error.message;
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await api(`/admin/users/${state.selectedUserId}/password`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ new_password: newPassword.value }),
  });
  newPassword.value = '';
  setStatus('Password changed. Existing login tokens remain valid until they expire.');
});

removeSubscription.addEventListener('click', async () => {
  const user = selectedUser();
  if (!user) return;
  const confirmation = 'REMOVE_SUBSCRIPTION';
  if (
    !(await confirmAction(
      `This immediately cancels Stripe for ${user.email} and removes Premium.`,
      confirmation,
    ))
  ) {
    setStatus('Subscription removal canceled.');
    return;
  }
  const updated = await api(`/admin/users/${user.id}/subscription/remove`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ confirmation }),
  });
  state.users = state.users.map((item) => (item.id === updated.id ? updated : item));
  selectUser(updated.id);
  setStatus('Stripe subscription canceled and Premium removed.');
});

document.querySelectorAll('.admin-prompt-form').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const kind = form.dataset.kind;
    const textarea = form.querySelector('textarea');
    const updated = await api(`/admin/prompts/${kind}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ text: textarea.value }),
    });
    const labels = { chat: 'Chat', topic: 'Topic' };
    textarea.value = updated.text;
    setStatus(`${labels[kind] || kind} prompt saved and active for the next request.`);
  });
});

document.querySelector('#refresh-users').addEventListener('click', () =>
  loadUsers()
    .then(() => setStatus('Users refreshed.'))
    .catch((error) => setStatus(error.message, true)),
);
function showLogin() {
  adminApp.classList.add('hidden');
  loginView.classList.remove('hidden');
  loginPassword.value = '';
  loginUsername.focus();
}

function showAdmin() {
  if (location.hash === '#settings' && !appSettingsSnapshot) void loadAppSettings();
  loginView.classList.add('hidden');
  adminApp.classList.remove('hidden');
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    const response = await api('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUsername.value, password: loginPassword.value }),
    });
    adminToken = response.access_token;
    localStorage.setItem('feely_admin_token', adminToken);
    const current = await api('/admin/status', { headers: authHeaders() });
    statusLine.dataset.username = current.username;
    showAdmin();
    await Promise.all([loadUsers(), loadPrompts(), loadFeedback(), loadMapCategories()]);
    setStatus('Administration ready.');
  } catch (error) {
    loginError.textContent = error.message;
  }
});

document.querySelector('#admin-logout').addEventListener('click', () => {
  adminToken = null;
  appSettingsSnapshot = null;
  localStorage.removeItem('feely_admin_token');
  showLogin();
});
window.addEventListener('unhandledrejection', (event) => {
  setStatus(event.reason?.message || 'Administration request failed.', true);
});

async function start() {
  if (!adminToken) {
    showLogin();
    return;
  }
  try {
    const status = await api('/admin/status', { headers: authHeaders() });
    statusLine.dataset.username = status.username;
    showAdmin();
    await Promise.all([loadUsers(), loadPrompts(), loadFeedback(), loadMapCategories()]);
    setStatus(`Administration ready · ${status.username}`);
  } catch (error) {
    adminToken = null;
    localStorage.removeItem('feely_admin_token');
    showLogin();
    loginError.textContent = error.message;
  }
}
start();

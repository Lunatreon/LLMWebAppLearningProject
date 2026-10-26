function resolveApiBase() {
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(window.location.hostname)) {
    return 'http://127.0.0.1:8000/api/v1';
  }
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
async function loadMapCategories() {
  const token = adminToken;
  const rows = await api('/admin/map/categories', { headers: authHeaders() });
  if (adminToken !== token) return;
  mapCategoryRows = rows;
  const select = document.querySelector('#map-category-select');
  select.replaceChildren(new Option('New category', ''));
  rows.forEach((row) =>
    select.append(
      new Option(
        `${row.kind}: ${row.label}${row.active ? '' : ' (disabled)'}`,
        `${row.kind}/${row.key}`,
      ),
    ),
  );
}
const mapCategoryForm = document.querySelector('#map-category-form');
document.querySelector('#map-category-select').addEventListener('change', (event) => {
  mapCategoryForm.reset();
  const row = mapCategoryRows.find((row) => `${row.kind}/${row.key}` === event.target.value);
  mapCategoryForm.elements.key.readOnly = Boolean(row);
  mapCategoryForm.elements.kind.disabled = Boolean(row);
  if (!row) return;
  for (const field of ['kind', 'key', 'label', 'description', 'position'])
    mapCategoryForm.elements[field].value = row[field];
  for (const field of ['active', 'llm_enabled', 'supports_completion'])
    mapCategoryForm.elements[field].checked = row[field];
});
mapCategoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = mapCategoryForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const elements = mapCategoryForm.elements;
    const body = {
      label: elements.label.value,
      description: elements.description.value,
      position: Number(elements.position.value),
    };
    for (const field of ['active', 'llm_enabled', 'supports_completion'])
      body[field] = elements[field].checked;
    await api(
      `/admin/map/categories/${encodeURIComponent(elements.kind.value)}/${encodeURIComponent(elements.key.value)}`,
      {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(body),
      },
    );
    await loadMapCategories();
    mapCategoryForm.reset();
    elements.key.readOnly = false;
    elements.kind.disabled = false;
    setStatus('Category saved. New map loads and model calls use the updated catalog.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function authHeaders() {
  return { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
}
async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Request failed (${response.status})`);
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
  state.users.forEach((user) => {
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
  userEditor.classList.remove('hidden');
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

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const updated = await api(`/admin/users/${state.selectedUserId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      email: userEmail.value,
      username: userUsername.value,
      display_name: userDisplayName.value || null,
      is_active: userActive.checked,
      is_email_verified: userVerified.checked,
      role: userRole.value,
    }),
  });
  state.users = state.users.map((user) => (user.id === updated.id ? updated : user));
  selectUser(updated.id);
  setStatus('User saved.');
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
    showAdmin();
    await Promise.all([loadUsers(), loadPrompts(), loadFeedback(), loadMapCategories()]);
    setStatus('Administration ready.');
  } catch (error) {
    loginError.textContent = error.message;
  }
});

document.querySelector('#admin-logout').addEventListener('click', () => {
  adminToken = null;
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

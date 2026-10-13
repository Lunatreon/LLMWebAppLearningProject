// Run only with isolated-registration-server.py --password-change (port 18012).
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const origin = 'http://127.0.0.1:18012';
const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
});
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let controller;
try {
  assert.equal((await (await fetch(`${origin}/__contract/fixture`)).json()).isolated, true);
  const { SessionController } = await vite.ssrLoadModule('/src/services/sessionController.ts');
  const { ApiClient } = await vite.ssrLoadModule('/src/services/apiClient.ts');
  const { loadCaptchaConfig, registrationPayload, register } = await vite.ssrLoadModule(
    '/src/features/auth/registration/registrationApi.ts',
  );
  const { loadCurrentTerms } = await vite.ssrLoadModule('/src/features/terms/termsApi.ts');
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  const { changePassword } = await vite.ssrLoadModule(
    '/src/features/account/password/changePasswordApi.ts',
  );
  const { updateProfile } = await vite.ssrLoadModule('/src/features/account/accountApi.ts');
  controller = new SessionController(`${origin}/api/v1`);
  await controller.reload();
  const captcha = await loadCaptchaConfig(controller.api);
  const oldPassword = 'Isolated-old-account-password';
  const newPassword = ' Isolated-new-account-password ';
  const seed = async (name) =>
    register(
      controller.api,
      registrationPayload(
        { email: `${name}@example.com`, username: name, password: oldPassword, website: '' },
        captcha,
        'contract-solved',
        await loadCurrentTerms(controller.api),
        true,
      ),
    );
  const setState = async (payload) => {
    assert.equal(
      (
        await fetch(`${origin}/__contract/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      ).status,
      200,
    );
  };
  const member = await seed('password-contract');
  await assert.rejects(
    changePassword(
      controller.api,
      { current_password: oldPassword, new_password: newPassword },
      'none',
    ),
    (error) => error.status === 401,
  );
  const missingBearer = await fetch(`${origin}/api/v1/users/me/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: oldPassword, new_password: newPassword }),
  });
  assert.equal(missingBearer.status, 401);
  const loggedIn = await login(controller.api, { email: member.email, password: oldPassword });
  await controller.establishSession(loggedIn.access_token, controller.getSnapshot().session);
  const other = await (
    await fetch(`${origin}/__contract/token?email=${encodeURIComponent(member.email)}`)
  ).json();
  assert.notEqual(other.access_token, loggedIn.access_token);
  const anotherSession = new ApiClient({
    baseUrl: `${origin}/api/v1`,
    getToken: () => other.access_token,
  });
  const capabilities = controller.getSnapshot().session.subscription;
  await assert.rejects(
    changePassword(
      controller.api,
      { current_password: 'incorrect-password', new_password: newPassword },
      loggedIn.access_token,
    ),
    (error) => error.status === 403 && error.message === 'Current password is incorrect',
  );
  await assert.rejects(
    changePassword(
      controller.api,
      { current_password: null, new_password: newPassword },
      loggedIn.access_token,
    ),
    (error) => error.status === 403,
  );
  await assert.rejects(
    changePassword(
      controller.api,
      { current_password: oldPassword, new_password: 'short' },
      loggedIn.access_token,
    ),
    (error) => error.status === 422,
  );
  await assert.rejects(
    changePassword(
      controller.api,
      { current_password: oldPassword, new_password: 'p'.repeat(129) },
      loggedIn.access_token,
    ),
    (error) => error.status === 422,
  );
  // Advisory copy is not a backend reuse restriction.
  assert.equal(
    (
      await changePassword(
        controller.api,
        { current_password: oldPassword, new_password: oldPassword },
        loggedIn.access_token,
      )
    ).has_password,
    true,
  );
  const response = await changePassword(
    controller.api,
    { current_password: oldPassword, new_password: newPassword },
    loggedIn.access_token,
  );
  assert.equal(response.id, member.id);
  assert.equal(response.has_password, true);
  assert.equal(response.auth_provider, 'password');
  assert.equal('access_token' in response, false);
  assert.equal('new_password' in response, false);
  assert.equal('current_password' in response, false);
  assert.equal(controller.applyAccountResponse(response, loggedIn.access_token), true);
  assert.equal(controller.getSnapshot().session.subscription, capabilities);
  assert.equal(storage.get('feely_token'), loggedIn.access_token);
  assert.equal(storage.size, 1);
  await controller.reload({ force: true });
  assert.equal(controller.getSnapshot().session.status, 'authenticated');
  assert.equal(
    (await anotherSession.request('/users/me/account', { authenticated: true })).id,
    member.id,
  );
  await assert.rejects(
    login(controller.api, { email: member.email, password: oldPassword }),
    (error) => error.status === 401,
  );
  assert.equal(
    (await login(controller.api, { email: member.email, password: newPassword })).token_type,
    'bearer',
  );
  await setState({ terms_version: 'password-change-v2' });
  await controller.reload({ force: true });
  assert.equal(controller.getSnapshot().session.termsRequired, true);
  assert.equal(
    (
      await changePassword(
        controller.api,
        { current_password: newPassword, new_password: newPassword },
        loggedIn.access_token,
      )
    ).id,
    member.id,
  );
  const profile = await updateProfile(
    controller.api,
    {
      display_name: 'Profile after password change',
      username: member.username,
      email: member.email,
      avatar_url: null,
      bio: null,
    },
    loggedIn.access_token,
  );
  assert.equal(profile.display_name, 'Profile after password change');

  const noPassword = await seed('passwordless-contract');
  await setState({ email: noPassword.email, passwordless: true });
  controller.signOut();
  const passwordlessToken = await (
    await fetch(`${origin}/__contract/token?email=${encodeURIComponent(noPassword.email)}`)
  ).json();
  await controller.establishSession(
    passwordlessToken.access_token,
    controller.getSnapshot().session,
  );
  assert.equal(controller.getSnapshot().session.account.has_password, false);
  const established = await changePassword(
    controller.api,
    { current_password: null, new_password: newPassword },
    passwordlessToken.access_token,
  );
  assert.equal(established.has_password, true);
  assert.equal(established.auth_provider, 'password');
  assert.equal(controller.applyAccountResponse(established, passwordlessToken.access_token), true);
  assert.equal(storage.get('feely_token'), passwordlessToken.access_token);
  assert.equal(
    (await login(controller.api, { email: noPassword.email, password: newPassword })).token_type,
    'bearer',
  );
  await setState({ http_limit: 1 });
  // General middleware rate limit, not an invented password-specific/auth limit.
  await changePassword(
    controller.api,
    { current_password: newPassword, new_password: newPassword },
    passwordlessToken.access_token,
  );
  await assert.rejects(
    changePassword(
      controller.api,
      { current_password: newPassword, new_password: newPassword },
      passwordlessToken.access_token,
    ),
    (error) => error.status === 429 && Number(error.retryAfter) > 0,
  );
  console.log(
    'PASS: authenticated PATCH payload/Account response, wrong current/validation/reuse/provider rules, no replacement JWT, multiple valid sessions, Terms exemption/Profile preservation and real general HTTP rate limiting.',
  );
} finally {
  controller?.stop();
  await vite.close();
  delete globalThis.localStorage;
}

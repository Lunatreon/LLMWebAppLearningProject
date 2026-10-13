// Use isolated-registration-server.py --recovery on fixed local port 18011 only.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const origin = 'http://127.0.0.1:18011';
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
  const { loadCaptchaConfig, registrationPayload, register } = await vite.ssrLoadModule(
    '/src/features/auth/registration/registrationApi.ts',
  );
  const { loadCurrentTerms } = await vite.ssrLoadModule('/src/features/terms/termsApi.ts');
  const { requestPasswordRecovery, resetPassword } = await vite.ssrLoadModule(
    '/src/features/auth/recovery/recoveryApi.ts',
  );
  const { recoverySearch, readResetToken } = await vite.ssrLoadModule(
    '/src/features/auth/recovery/resetLink.ts',
  );
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  controller = new SessionController(`${origin}/api/v1`);
  await controller.reload();
  const captcha = await loadCaptchaConfig(controller.api);
  const terms = await loadCurrentTerms(controller.api);
  const oldPassword = 'Isolated-old-reset-password';
  const newPassword = ' Isolated-new-reset-password ';
  const generic = {
    sent: true,
    detail: 'If that account exists, a password reset email has been sent.',
  };
  const invalid = (error) =>
    error.status === 400 && error.message === 'Password reset link is invalid or expired.';
  const seed = (name) =>
    register(
      controller.api,
      registrationPayload(
        { email: `${name}@example.com`, username: name, password: oldPassword, website: '' },
        captcha,
        'contract-solved',
        terms,
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
  const emails = async (address) =>
    (
      await (
        await fetch(`${origin}/__contract/reset-email?email=${encodeURIComponent(address)}`)
      ).json()
    ).messages;
  const latestToken = async (address) => {
    const messages = await emails(address);
    const link = new URL(
      messages.at(-1).match(/http:\/\/127\.0\.0\.1:5500\/\?reset_password_token=\S+/)[0],
    );
    assert.equal(link.origin, 'http://127.0.0.1:5500');
    assert.equal(link.pathname, '/');
    assert.deepEqual([...link.searchParams.keys()], ['reset_password_token']);
    const result = readResetToken(link.search);
    assert.equal(result.problem, '');
    assert.equal(recoverySearch(link.search), '');
    return result.value;
  };
  const member = await seed('reset-member');
  const before = await login(controller.api, { email: member.email, password: oldPassword });
  await controller.establishSession(before.access_token, controller.getSnapshot().session);
  assert.deepEqual(
    await requestPasswordRecovery(controller.api, ` ${member.email.toUpperCase()} `),
    generic,
  );
  assert.deepEqual(await requestPasswordRecovery(controller.api, 'unknown@example.com'), generic);
  assert.equal((await emails('unknown@example.com')).length, 0);
  const token = await latestToken(member.email);
  await assert.rejects(
    resetPassword(controller.api, 'invalid-but-long-enough-token', newPassword),
    invalid,
  );
  await assert.rejects(
    resetPassword(controller.api, 'short', newPassword),
    (error) => error.status === 422,
  );
  await assert.rejects(
    resetPassword(controller.api, token, 'short'),
    (error) => error.status === 422,
  );
  await assert.rejects(
    resetPassword(controller.api, token, 'p'.repeat(129)),
    (error) => error.status === 422,
  );
  assert.deepEqual(await resetPassword(controller.api, token, newPassword), {
    reset: true,
    detail: 'Your password has been reset. You can now log in.',
  });
  await assert.rejects(resetPassword(controller.api, token, newPassword), invalid);
  // Reset returns no JWT and does not revoke an existing one in this backend.
  assert.equal(storage.size, 1);
  assert.equal(storage.get('feely_token'), before.access_token);
  await controller.reload({ force: true });
  assert.equal(controller.getSnapshot().session.status, 'authenticated');
  assert.equal(controller.getSnapshot().session.account.id, member.id);
  await assert.rejects(
    login(controller.api, { email: member.email, password: oldPassword }),
    (error) => error.status === 401,
  );
  assert.equal(
    (await login(controller.api, { email: member.email, password: newPassword })).token_type,
    'bearer',
  );

  const expired = await seed('reset-expired');
  await requestPasswordRecovery(controller.api, expired.email);
  const expiredToken = await latestToken(expired.email);
  await setState({ email: expired.email, expire_reset: true });
  await assert.rejects(resetPassword(controller.api, expiredToken, newPassword), invalid);
  const replaced = await seed('reset-replaced');
  await requestPasswordRecovery(controller.api, replaced.email);
  const older = await latestToken(replaced.email);
  await requestPasswordRecovery(controller.api, replaced.email);
  const newer = await latestToken(replaced.email);
  assert.notEqual(older, newer);
  await assert.rejects(resetPassword(controller.api, older, newPassword), invalid);
  assert.equal((await resetPassword(controller.api, newer, newPassword)).reset, true);
  const disabled = await seed('reset-disabled');
  await requestPasswordRecovery(controller.api, disabled.email);
  const disabledToken = await latestToken(disabled.email);
  await setState({ email: disabled.email, disable: true });
  const count = (await emails(disabled.email)).length;
  assert.deepEqual(await requestPasswordRecovery(controller.api, disabled.email), generic);
  assert.equal((await emails(disabled.email)).length, count);
  await assert.rejects(resetPassword(controller.api, disabledToken, newPassword), invalid);
  for (let index = 0; index < 3; index++)
    assert.deepEqual(
      await requestPasswordRecovery(controller.api, 'quota-unknown@example.com'),
      generic,
    );
  await assert.rejects(
    requestPasswordRecovery(controller.api, 'quota-unknown@example.com'),
    (error) => error.status === 429 && Number(error.retryAfter) > 0,
  );
  await setState({ reset_enabled: false });
  await assert.rejects(
    requestPasswordRecovery(controller.api, 'another@example.com'),
    (error) => error.status === 503,
  );
  await setState({ auth_limit: 1 });
  await assert.rejects(
    resetPassword(controller.api, 'invalid-but-long-enough-token', newPassword),
    invalid,
  );
  await assert.rejects(
    resetPassword(controller.api, 'invalid-but-long-enough-token', newPassword),
    (error) => error.status === 429 && Number(error.retryAfter) > 0,
  );
  console.log(
    'PASS: real reset email/link construction, recovery anti-enumeration/quotas, exact reset payload/validation/expiry/replacement/single-use, new password Login, preserved existing JWT and shared auth rate limit.',
  );
} finally {
  controller?.stop();
  await vite.close();
  delete globalThis.localStorage;
}

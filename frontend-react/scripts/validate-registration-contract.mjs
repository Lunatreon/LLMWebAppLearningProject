// Uses only the two isolated-registration-server.py fixtures on fixed local ports.
// No real SMTP/CAPTCHA/LLM/billing and no application database writes.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
});
let controller;
try {
  const { SessionController } = await vite.ssrLoadModule('/src/services/sessionController.ts');
  const { loadCaptchaConfig, registrationPayload, register } = await vite.ssrLoadModule(
    '/src/features/auth/registration/registrationApi.ts',
  );
  const { loadCurrentTerms } = await vite.ssrLoadModule('/src/features/terms/termsApi.ts');
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  const password = 'Isolated-registration-password';
  for (const port of [18007, 18008]) {
    const origin = `http://127.0.0.1:${port}`;
    const fixture = await (await fetch(`${origin}/__contract/fixture`)).json();
    assert.equal(fixture.isolated, true);
    controller = new SessionController(`${origin}/api/v1`);
    await controller.reload();
    const captcha = await loadCaptchaConfig(controller.api);
    assert.equal(captcha.enabled, true);
    assert.equal(captcha.provider, 'turnstile');
    assert.equal(captcha.site_key, 'isolated-public-site-key');
    assert.equal('secret_key' in captcha, false);
    const terms = await loadCurrentTerms(controller.api);
    const fields = {
      email: ' CONTRACT-NEW@EXAMPLE.COM ',
      username: ' contract_new ',
      password,
      website: '',
    };
    const payload = registrationPayload(fields, captcha, 'contract-solved', terms, true);
    assert.deepEqual(Object.keys(payload).sort(), [
      'captcha_token',
      'email',
      'password',
      'terms_accepted',
      'terms_document_sha256',
      'terms_version',
      'username',
      'website',
    ]);
    assert.equal(payload.terms_version, terms.version);
    for (const [changes, status] of [
      [{ captcha_token: null }, 400],
      [{ captcha_token: 'expired' }, 400],
      [{ captcha_token: 'wrong-action' }, 400],
      [{ terms_accepted: false }, 422],
      [{ terms_accepted: 'true' }, 422],
      [{ terms_version: 'old-version' }, 409],
      [{ terms_document_sha256: 'b'.repeat(64) }, 409],
      [{ website: 'filled-honeypot' }, 400],
      [{ password: 'short' }, 422],
      [{ username: 'bad name' }, 422],
      [{ email: 'not-an-email' }, 422],
    ]) {
      await assert.rejects(
        register(controller.api, { ...payload, ...changes }),
        (error) => error.status === status,
      );
    }
    const user = await register(controller.api, payload);
    assert.ok(user.id);
    assert.equal(user.email, 'contract-new@example.com');
    assert.equal(user.username, 'contract_new');
    assert.equal(user.display_name, 'contract_new');
    assert.equal(user.is_email_verified, !fixture.verification_enabled);
    assert.equal('access_token' in user, false);
    assert.equal('pin' in user, false);
    assert.equal(storage.size, 0);
    assert.equal(controller.getSnapshot().session.status, 'unauthenticated');
    for (const changes of [{ username: 'another_user' }, { email: 'another@example.com' }]) {
      await assert.rejects(
        register(controller.api, { ...payload, ...changes }),
        (error) =>
          error.status === 409 &&
          error.message === 'A user with this email or username already exists',
      );
    }
    if (fixture.verification_enabled) {
      await assert.rejects(
        login(controller.api, { email: user.email, password }),
        (error) => error.status === 403,
      );
      const { pin } = await (
        await fetch(`${origin}/__contract/pin?email=${encodeURIComponent(user.email)}`)
      ).json();
      assert.match(pin, /^[0-9]{6}$/);
      // Models the unchanged reference PIN form, not a React PIN implementation.
      const activation = await controller.api.request('/auth/email-verification/confirm', {
        method: 'POST',
        body: JSON.stringify({ email: user.email, pin }),
      });
      assert.equal(activation.verified, true);
      await assert.rejects(
        register(controller.api, {
          ...payload,
          email: 'delivery-fails@example.com',
          username: 'delivery_fails',
        }),
        (error) => error.status === 502 && error.message.includes('Your account was created'),
      );
      const exists = await (
        await fetch(`${origin}/__contract/account-exists?email=delivery-fails%40example.com`)
      ).json();
      assert.equal(exists.exists, true);
    }
    const response = await login(controller.api, { email: user.email, password });
    await controller.establishSession(response.access_token, controller.getSnapshot().session);
    const session = controller.getSnapshot().session;
    assert.equal(session.status, 'authenticated');
    assert.equal(session.account.is_email_verified, true);
    assert.equal(session.termsRequired, false);
    assert.equal(session.terms.accepted_current, true);
    assert.equal(session.terms.acceptances[0].client, 'api');
    assert.equal(storage.get('feely_token'), response.access_token);
    controller.signOut();
    controller.stop();
    controller = null;
  }
  console.log(
    'PASS: isolated registration/CAPTCHA/consent/duplicate/validation/delivery contracts; unverified no-JWT response, real PIN activation then login, and verification-disabled auto-login/session with registration acceptance.',
  );
} finally {
  controller?.stop();
  await vite.close();
  delete globalThis.localStorage;
}

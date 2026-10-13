// Run with isolated-registration-server.py --activation on fixed port 18010.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const origin = 'http://127.0.0.1:18010';
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
  const { confirmActivation, resendActivation } = await vite.ssrLoadModule(
    '/src/features/auth/activation/activationApi.ts',
  );
  const { loadCurrentTerms, acceptTerms } = await vite.ssrLoadModule(
    '/src/features/terms/termsApi.ts',
  );
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  const { submitFeedback } = await vite.ssrLoadModule('/src/features/feedback/feedbackApi.ts');
  controller = new SessionController(`${origin}/api/v1`);
  await controller.reload();
  const captcha = await loadCaptchaConfig(controller.api);
  const terms = await loadCurrentTerms(controller.api);
  const password = 'Isolated-activation-password';
  const seed = async (name) =>
    register(
      controller.api,
      registrationPayload(
        { email: `${name}@example.com`, username: name, password, website: '' },
        captcha,
        'contract-solved',
        terms,
        true,
      ),
    );
  const pinFor = async (email) =>
    (await (await fetch(`${origin}/__contract/pin?email=${encodeURIComponent(email)}`)).json()).pin;
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
  const bad = (error) =>
    error.status === 400 &&
    error.message === 'Verification code or link is invalid or expired. Request a new code.';
  const member = await seed('activation-member');
  assert.equal(member.is_email_verified, false);
  assert.equal(storage.size, 0);
  const firstPin = await pinFor(member.email);
  const wrong = firstPin === '000000' ? '000001' : '000000';
  await assert.rejects(confirmActivation(controller.api, member.email, wrong), bad);
  await assert.rejects(confirmActivation(controller.api, 'unknown@example.com', wrong), bad);
  await assert.rejects(
    confirmActivation(controller.api, member.email, 'invalid'),
    (error) => error.status === 422,
  );
  const resend = await resendActivation(controller.api, ` ${member.email.toUpperCase()} `);
  assert.deepEqual(resend, {
    sent: true,
    detail: 'If that account exists and needs verification, an email has been sent.',
  });
  assert.deepEqual(await resendActivation(controller.api, 'unknown@example.com'), resend);
  const pin = await pinFor(member.email);
  assert.match(pin, /^[0-9]{6}$/);
  const response = await confirmActivation(
    controller.api,
    ` ${member.email.toUpperCase()} `,
    ` ${pin} `,
  );
  assert.deepEqual(response, { verified: true, detail: 'Email verified.' });
  assert.equal(storage.size, 0);
  assert.equal(controller.getSnapshot().session.status, 'unauthenticated');
  await assert.rejects(confirmActivation(controller.api, member.email, pin), bad);
  assert.deepEqual(await resendActivation(controller.api, member.email), resend); // Already verified does not enumerate.

  // Separate Login remains mandatory after signed-out activation.
  const loggedIn = await login(controller.api, { email: member.email, password });
  await controller.establishSession(loggedIn.access_token, controller.getSnapshot().session);
  assert.equal(controller.getSnapshot().session.account.is_email_verified, true);
  assert.equal(controller.getSnapshot().session.termsRequired, false);
  assert.ok(
    (
      await submitFeedback(controller.api, {
        category: 'general',
        message: 'Activation login contract check',
      })
    ).id,
  );
  await setState({ terms_version: 'activation-publication-v2' });
  await controller.reload({ force: true });
  assert.equal(controller.getSnapshot().session.termsRequired, true);
  await acceptTerms(controller.api, controller.getSnapshot().session.terms.current);
  await controller.reload({ force: true });
  assert.equal(controller.getSnapshot().session.termsRequired, false);
  assert.equal(storage.get('feely_token'), loggedIn.access_token);
  controller.signOut();
  // Future synthetic registrations consent to the current publication too.
  terms.version = 'activation-publication-v2';

  const expired = await seed('activation-expired');
  const expiredPin = await pinFor(expired.email);
  await setState({ email: expired.email, expire: true });
  await assert.rejects(confirmActivation(controller.api, expired.email, expiredPin), bad);
  await resendActivation(controller.api, expired.email);
  assert.equal(
    (await confirmActivation(controller.api, expired.email, await pinFor(expired.email))).verified,
    true,
  );
  const disabled = await seed('activation-disabled');
  const disabledPin = await pinFor(disabled.email);
  await setState({ email: disabled.email, disable: true });
  await assert.rejects(confirmActivation(controller.api, disabled.email, disabledPin), bad);
  assert.deepEqual(await resendActivation(controller.api, disabled.email), resend);

  const locked = await seed('activation-locked');
  const lockPin = await pinFor(locked.email);
  const lockWrong = lockPin === '000000' ? '000001' : '000000';
  for (let index = 0; index < 5; index++)
    await assert.rejects(confirmActivation(controller.api, locked.email, lockWrong), bad);
  await assert.rejects(confirmActivation(controller.api, locked.email, lockPin), bad);
  await resendActivation(controller.api, locked.email);
  assert.equal(
    (await confirmActivation(controller.api, locked.email, await pinFor(locked.email))).verified,
    true,
  );
  // Real resend quota applies even to an unknown address, preserving privacy.
  for (let index = 0; index < 3; index++)
    assert.deepEqual(await resendActivation(controller.api, 'quota-unknown@example.com'), resend);
  await assert.rejects(
    resendActivation(controller.api, 'quota-unknown@example.com'),
    (error) => error.status === 429 && Number(error.retryAfter) > 0,
  );
  for (let index = 0; index < 10; index++)
    await assert.rejects(
      confirmActivation(controller.api, 'quota-confirm@example.com', '000000'),
      bad,
    );
  await assert.rejects(
    confirmActivation(controller.api, 'quota-confirm@example.com', '000000'),
    (error) => error.status === 429 && Number(error.retryAfter) > 0,
  );
  console.log(
    'PASS: real registration/activation/resend payloads, no activation JWT, normalization, generic failures/anti-enumeration, expiry/lockout/resend recovery, actual quotas, separate Login/session/Feedback and Terms revision flow.',
  );
} finally {
  controller?.stop();
  await vite.close();
  delete globalThis.localStorage;
}

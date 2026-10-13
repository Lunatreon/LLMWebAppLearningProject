// Run only with isolated-auth-server.py. Never sends requests to the real app DB.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const baseUrl = 'http://127.0.0.1:18006/api/v1';
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
  const { SessionController } = await vite.ssrLoadModule('/src/services/sessionController.ts');
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  const { acceptTerms } = await vite.ssrLoadModule('/src/features/terms/termsApi.ts');
  const { updateProfile } = await vite.ssrLoadModule('/src/features/account/accountApi.ts');
  const { submitFeedback } = await vite.ssrLoadModule('/src/features/feedback/feedbackApi.ts');
  controller = new SessionController(baseUrl);
  await controller.reload();
  assert.equal(controller.getSnapshot().session.status, 'unauthenticated');
  for (const identifier of [
    'contract-member@example.com',
    'contract-disabled@example.com',
    'unknown@example.com',
  ]) {
    await assert.rejects(
      login(controller.api, { email: identifier, password: 'Wrong-contract-password' }),
      (error) => error.status === 401 && error.message === 'Incorrect email, username, or password',
    );
  }
  await assert.rejects(
    login(controller.api, {
      email: 'contract-disabled@example.com',
      password: 'Isolated-contract-password',
    }),
    (error) => error.status === 401,
  );
  await assert.rejects(
    login(controller.api, {
      email: 'contract-unverified@example.com',
      password: 'Isolated-contract-password',
    }),
    (error) =>
      error.status === 403 && error.message === 'Please verify your email before logging in.',
  );
  await assert.rejects(
    login(controller.api, { email: 'contract-member@example.com', password: 'short' }),
    (error) => error.status === 422,
  );
  assert.equal(storage.size, 0);

  // Backend accepts username too; the original email-only form is intentionally preserved.
  const byUsername = await login(controller.api, {
    email: 'CONTRACT-MEMBER',
    password: 'Isolated-contract-password',
  });
  assert.equal(byUsername.token_type, 'bearer');
  const response = await login(controller.api, {
    email: '  CONTRACT-MEMBER@EXAMPLE.COM  ',
    password: 'Isolated-contract-password',
  });
  assert.deepEqual(Object.keys(response).sort(), ['access_token', 'token_type']);
  const claims = JSON.parse(Buffer.from(response.access_token.split('.')[1], 'base64url'));
  assert.equal(claims.token_type, 'user');
  assert.equal(typeof claims.sub, 'string');
  assert.ok(claims.exp > Date.now() / 1000);
  // Assertions inspect synthetic JWTs locally; no credentials/claims/tokens are printed.
  const expected = controller.getSnapshot().session;
  assert.equal(await controller.establishSession(response.access_token, expected), true);
  assert.equal(storage.get('feely_token'), response.access_token);
  assert.equal(storage.size, 1);
  let session = controller.getSnapshot().session;
  assert.equal(session.status, 'authenticated');
  assert.equal(session.account.email, 'contract-member@example.com');
  assert.equal(typeof session.subscription.my_map_access, 'boolean');
  assert.equal(session.termsRequired, true);
  await assert.rejects(
    submitFeedback(controller.api, { category: 'general', message: 'Before terms acceptance' }),
    (error) => error.status === 423,
  );

  await acceptTerms(controller.api, session.terms.current);
  await controller.reload({ force: true });
  session = controller.getSnapshot().session;
  assert.equal(session.status, 'authenticated');
  assert.equal(session.termsRequired, false);
  assert.equal(session.terms.accepted_current, true);
  const profile = await updateProfile(
    controller.api,
    {
      display_name: 'Contract member',
      username: session.account.username,
      email: session.account.email,
      avatar_url: null,
      bio: 'Temporary isolated login validation',
    },
    response.access_token,
  );
  assert.equal(controller.applyAccountResponse(profile, response.access_token), true);
  assert.equal(controller.getSnapshot().session.account.display_name, 'Contract member');
  const feedback = await submitFeedback(controller.api, {
    category: 'general',
    message: 'Feedback after isolated sign-in',
  });
  assert.ok(feedback.id);
  assert.equal(storage.get('feely_token'), response.access_token);

  // Fresh sign-in honors previously accepted Terms via the same shared load.
  controller.signOut();
  const accepted = await login(controller.api, {
    email: 'contract-member@example.com',
    password: 'Isolated-contract-password',
  });
  await controller.establishSession(accepted.access_token, controller.getSnapshot().session);
  assert.equal(controller.getSnapshot().session.termsRequired, false);
  // A syntactically valid but tampered token reaches backend 401 and existing clearing.
  const pieces = accepted.access_token.split('.');
  pieces[2] = `${pieces[2][0] === 'a' ? 'b' : 'a'}${pieces[2].slice(1)}`;
  storage.set('feely_token', pieces.join('.'));
  await controller.reload({ force: true });
  assert.equal(controller.getSnapshot().session.status, 'unauthenticated');
  assert.equal(storage.get('feely_token'), undefined);
  console.log(
    'PASS: isolated backend login payload/response/errors/JWT, session load, Terms, Account, Feedback, accepted-session reload and tampered-token clearing.',
  );
} finally {
  controller?.stop();
  await vite.close();
  delete globalThis.localStorage;
}

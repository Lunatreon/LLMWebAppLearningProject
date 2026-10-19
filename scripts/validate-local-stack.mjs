// Uses the unchanged React clients with real HTTP, PostgreSQL and SMTP capture.
// Opt in explicitly: FEELY_LOCAL_STACK_CHECK=1. Never use this on a deployed application.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const frontend = fileURLToPath(new URL('../frontend-react/', import.meta.url));
const origin = process.env.FEELY_STACK_API_URL || 'http://127.0.0.1:8000';
const inbox = process.env.FEELY_STACK_MAILPIT_URL || 'http://127.0.0.1:8025';
const appOrigin = process.env.FEELY_STACK_APP_URL || 'http://127.0.0.1:5173';
const privateDirectory = process.env.FEELY_STACK_PRIVATE_DIR;
const verifySaved = process.env.FEELY_STACK_VERIFY_SAVED === '1';
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options = {}) =>
  originalFetch(url, {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });

function rememberSecret(value) {
  if (privateDirectory) {
    appendFileSync(path.join(privateDirectory, 'secrets.jsonl'), `${JSON.stringify(value)}\n`, {
      mode: 0o600,
    });
  }
}
if (process.env.FEELY_LOCAL_STACK_CHECK !== '1') {
  throw new Error('Set FEELY_LOCAL_STACK_CHECK=1 to create synthetic data in the local stack.');
}
for (const url of [origin, inbox, appOrigin]) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('Only loopback HTTP targets are supported by this local rehearsal.');
  }
}
const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
});
const requireFrontend = createRequire(path.join(frontend, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFrontend.resolve('vite')).href);
const vite = await createServer({
  root: frontend,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
let session;
let stage = 'health/configuration';
async function mailText(email, subject) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await fetch(`${inbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    assert.equal(result.status, 200);
    const list = (await result.json()).messages;
    const message = list.find((item) => item.Subject === subject);
    if (message) {
      const detail = await fetch(`${inbox}/api/v1/message/${message.ID}`);
      assert.equal(detail.status, 200);
      return (await detail.json()).Text;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Expected local SMTP message was not captured.');
}
try {
  const { SessionController } = await vite.ssrLoadModule('/src/services/sessionController.ts');
  const registration = await vite.ssrLoadModule(
    '/src/features/auth/registration/registrationApi.ts',
  );
  const { confirmActivation } = await vite.ssrLoadModule(
    '/src/features/auth/activation/activationApi.ts',
  );
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  const { loadCurrentTerms, acceptTerms } = await vite.ssrLoadModule(
    '/src/features/terms/termsApi.ts',
  );
  const { updateProfile } = await vite.ssrLoadModule('/src/features/account/accountApi.ts');
  const map = await vite.ssrLoadModule('/src/features/map/mapApi.ts');
  const chat = await vite.ssrLoadModule('/src/features/chat/chatApi.ts');
  const recovery = await vite.ssrLoadModule('/src/features/auth/recovery/recoveryApi.ts');
  const { readResetToken } = await vite.ssrLoadModule('/src/features/auth/recovery/resetLink.ts');
  session = new SessionController(`${origin}/api/v1`);
  await session.reload();
  assert.deepEqual(await session.api.request('/health'), { status: 'ok' });
  const emailConfig = await session.api.request('/auth/email/config');
  assert.equal(emailConfig.verification_enabled, true);
  assert.equal(emailConfig.password_reset_enabled, true);
  const captcha = await registration.loadCaptchaConfig(session.api);
  assert.equal(
    captcha.enabled,
    false,
    'This rehearsal requires local CAPTCHA-disabled configuration.',
  );
  const signIn = async (email, password) => {
    const token = await login(session.api, { email, password });
    rememberSecret(token.access_token);
    await session.establishSession(token.access_token, session.getSnapshot().session);
    assert.equal(session.getSnapshot().session.status, 'authenticated');
  };
  const verifyRecords = async (saved) => {
    await signIn(saved.email, saved.password);
    const account = await session.api.request('/users/me/account', {
      authenticated: true,
    });
    assert.equal(account.id, saved.memberId);
    assert.equal(account.display_name, 'Docker rehearsal');
    assert.equal(account.bio, 'Synthetic local integration account.');
    assert.equal((await chat.loadConversation(session.api, saved.chatId)).messages.length, 2);
    const entries = (await map.loadMap(session.api)).topic_spaces.flatMap(
      (topic) => topic.entries || [],
    );
    assert.ok(
      entries.some(
        (entry) =>
          entry.id === saved.practiceId &&
          entry.status === 'completed' &&
          entry.reflection === 'I felt calmer.',
      ),
    );
    if (saved.termsConfigured) {
      const terms = await session.api.request('/terms/me', {
        authenticated: true,
      });
      assert.equal(terms.accepted_current, true);
    }
  };
  if (verifySaved) {
    stage = 'saved HTTP records after container restart';
    assert.ok(privateDirectory);
    const saved = JSON.parse(readFileSync(path.join(privateDirectory, 'http-state.json'), 'utf8'));
    await verifyRecords(saved);
    console.log('PASS: saved Account, Terms, Chat, Map and Reflection after restart.');
  } else {
    if (process.env.FEELY_CHECK_SNAPSHOT === '1') {
      stage = 'migrated/restored snapshot reads';
      await signIn('deployment-snapshot@example.com', 'Snapshot-only-password-42');
      assert.equal(session.getSnapshot().session.account.id, 42);
      const preserved = await map.loadMap(session.api);
      assert.ok(preserved.topic_spaces.some((topic) => topic.title === 'Snapshot topic'));
      assert.ok(
        preserved.topic_spaces
          .flatMap((topic) => topic.entries || [])
          .some((entry) => entry.reflection === 'Snapshot reflection.'),
      );
      assert.equal(
        (await chat.loadConversation(session.api, 'snapshot-chat')).messages[0].content,
        'Saved snapshot message.',
      );
      session.signOut();
    }
    stage = 'registration/SMTP activation';
    const username = `stack-${randomUUID().slice(0, 8)}`;
    const email = `${username}@example.com`;
    const password = `Local-only-${randomUUID()}`;
    rememberSecret(password);
    const terms = await loadCurrentTerms(session.api);
    const member = await registration.register(
      session.api,
      registration.registrationPayload(
        { email, username, password, website: '' },
        captcha,
        '',
        terms,
        true,
      ),
    );
    assert.equal(member.is_email_verified, false);
    const activationText = await mailText(email, 'Your FeelY activation code');
    const pin = activationText.match(/activation PIN is:\s*(\d{6})/)[1];
    rememberSecret(pin);
    assert.equal((await confirmActivation(session.api, email, pin)).verified, true);
    stage = 'login/streaming Chat';
    await signIn(email, password);
    stage = 'Terms/Account';
    if (terms.configured) {
      assert.equal((await acceptTerms(session.api, terms)).version, terms.version);
      const accepted = await session.api.request('/terms/me', {
        authenticated: true,
      });
      assert.equal(accepted.accepted_current, true);
      assert.equal(accepted.acceptances.length, 1);
    }
    const account = await updateProfile(
      session.api,
      {
        email,
        username,
        display_name: 'Docker rehearsal',
        bio: 'Synthetic local integration account.',
        avatar_url: null,
      },
      session.getSnapshot().session.token,
    );
    assert.equal(account.display_name, 'Docker rehearsal');
    stage = 'login/streaming Chat';
    const abort = new AbortController();
    const conversation = await chat.createConversation(session.api, abort.signal);
    let streamed = '';
    await chat.generate(
      session.api,
      conversation.chat_id,
      'I took a walk today and noticed that slowing down helped me feel calmer.',
      abort.signal,
      (text) => {
        streamed += text;
      },
    );
    assert.ok(streamed);
    assert.equal(
      (await chat.loadConversation(session.api, conversation.chat_id)).messages.length,
      2,
    );
    stage = 'Map/Reflection persistence';
    const topic = (
      await map.createTopic(session.api, {
        title: 'Local rehearsal',
        category: 'experience',
        description: 'A chosen practice.',
        parent_topic_id: null,
        related_topic_ids: [],
        chat_id: conversation.chat_id,
      })
    ).topic;
    const practice = (
      await map.createEntry(session.api, {
        category: 'practice',
        text: 'Take a walk.',
        topic_space_id: topic.id,
        source_chat_id: conversation.chat_id,
      })
    ).entry;
    const completed = await map.updatePractice(
      session.api,
      practice.id,
      'completed',
      'I felt calmer.',
    );
    assert.equal(completed.practice.status, 'completed');
    assert.equal(completed.practice.reflection, 'I felt calmer.');
    assert.ok(
      (await map.loadMap(session.api)).topic_spaces
        .flatMap((item) => item.entries || [])
        .some((entry) => entry.id === practice.id && entry.reflection === 'I felt calmer.'),
    );
    stage = 'SMTP reset/React link parsing/login again';
    await recovery.requestPasswordRecovery(session.api, email);
    const resetText = await mailText(email, 'Reset your FeelY password');
    const resetUrl = new URL(resetText.match(/https?:\/\/\S+/)[0]);
    assert.equal(resetUrl.origin, new URL(appOrigin).origin);
    const reset = readResetToken(resetUrl.search);
    rememberSecret(reset.value);
    assert.equal(reset.problem, '');
    const newPassword = `Replacement-${randomUUID()}`;
    rememberSecret(newPassword);
    assert.equal((await recovery.resetPassword(session.api, reset.value, newPassword)).reset, true);
    session.signOut();
    await signIn(email, newPassword);
    assert.equal(session.getSnapshot().session.account.id, member.id);
    const saved = {
      email,
      password: newPassword,
      memberId: member.id,
      chatId: conversation.chat_id,
      practiceId: practice.id,
      termsConfigured: terms.configured,
    };
    await verifyRecords(saved);
    if (privateDirectory) {
      writeFileSync(path.join(privateDirectory, 'http-state.json'), JSON.stringify(saved), {
        mode: 0o600,
      });
    }
    console.log(
      'PASS: real SMTP/Mailpit activation/reset, unchanged React clients/session/link parsing, login, streamed Chat, Map and Reflection persistence. No credentials or email contents printed.',
    );
  }
} catch {
  console.error(
    `FAIL: ${stage}. Check local service configuration; credentials and email contents are not printed.`,
  );
  process.exitCode = 1;
} finally {
  session?.stop();
  await vite.close();
}

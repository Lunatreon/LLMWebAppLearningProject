// Run only with isolated-registration-server.py --journal (fixed port 18013).
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const origin = 'http://127.0.0.1:18013';
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
let session;
let journal;
try {
  assert.equal((await (await fetch(`${origin}/__contract/fixture`)).json()).isolated, true);
  const { SessionController } = await vite.ssrLoadModule('/src/services/sessionController.ts');
  const { JournalController } = await vite.ssrLoadModule(
    '/src/features/journal/JournalController.ts',
  );
  const { hasJournalAccess } = await vite.ssrLoadModule('/src/services/capabilities.ts');
  const { loadCaptchaConfig, registrationPayload, register } = await vite.ssrLoadModule(
    '/src/features/auth/registration/registrationApi.ts',
  );
  const { loadCurrentTerms, acceptTerms } = await vite.ssrLoadModule(
    '/src/features/terms/termsApi.ts',
  );
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  const api = await vite.ssrLoadModule('/src/features/journal/journalApi.ts');
  session = new SessionController(`${origin}/api/v1`);
  await session.reload();
  const captcha = await loadCaptchaConfig(session.api);
  const password = 'Isolated-journal-password';
  const seed = async (name) =>
    register(
      session.api,
      registrationPayload(
        { email: `${name}@example.com`, username: name, password, website: '' },
        captcha,
        'contract-solved',
        await loadCurrentTerms(session.api),
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
  const day = '2026-10-12';
  await assert.rejects(api.loadJournalEntry(session.api, day), (error) => error.status === 401);
  const member = await seed('journal-contract');
  const token = await login(session.api, { email: member.email, password });
  await session.establishSession(token.access_token, session.getSnapshot().session);
  assert.equal(hasJournalAccess(session.getSnapshot().session.subscription), false);
  await assert.rejects(api.loadJournalEntry(session.api, day), (error) => error.status === 402);
  await setState({ email: member.email, premium: true });
  await session.reload({ force: true });
  assert.equal(hasJournalAccess(session.getSnapshot().session.subscription), true);
  const empty = await api.loadJournalEntry(session.api, day);
  assert.equal(empty.content, '');
  assert.equal(empty.created_at, null);
  assert.deepEqual(empty.suggestions, []);
  assert.deepEqual(await api.loadJournalHistory(session.api), []); // Reading never creates an empty row.
  const content =
    '\n I value calm and honest communication in my relationships. Today I noticed that writing before reacting gave me room to make a choice I respect. I want to practice pausing before my next difficult conversation. \n';
  const saved = await api.saveJournalEntry(session.api, day, content);
  assert.equal(saved.content, content);
  assert.ok(saved.created_at);
  assert.ok(saved.updated_at);
  assert.ok(saved.word_count > 20);
  const update = await api.saveJournalEntry(session.api, day, `${content}Another sentence.`);
  assert.equal(update.created_at, saved.created_at);
  assert.equal((await api.loadJournalHistory(session.api)).length, 1);
  await assert.rejects(
    api.saveJournalEntry(session.api, day, 'x'.repeat(100001)),
    (error) => error.status === 422,
  );
  await assert.rejects(
    session.api.request(`/journal/entries/${day}`, {
      authenticated: true,
      method: 'PUT',
      body: JSON.stringify({ content, extra: true }),
    }),
    (error) => error.status === 422,
  );
  await assert.rejects(
    api.loadJournalEntry(session.api, 'not-a-date'),
    (error) => error.status === 422,
  );
  await api.saveJournalEntry(
    session.api,
    '2099-07-15',
    'Future dates are accepted by the unchanged backend.',
  );
  assert.equal((await api.loadJournalEntry(session.api, '2099-07-15')).entry_date, '2099-07-15');
  await api.saveJournalEntry(session.api, '2026-10-11', '');
  assert.ok(
    (await api.loadJournalHistory(session.api)).some(
      (item) => item.entry_date === '2026-10-11' && item.word_count === 0,
    ),
  );
  const analysed = await api.analyseJournalEntry(session.api, day);
  const topic = analysed.suggestions.find((item) => item.kind === 'topic');
  const mapEntry = analysed.suggestions.find((item) => item.kind === 'map_entry');
  assert.ok(topic);
  assert.ok(mapEntry);
  const accepted = await api.decideJournalSuggestion(session.api, day, topic.id, {
    accepted: true,
    title: 'Reviewed Journal topic',
    topic_category: 'experience',
    text: topic.text,
    category: 'own_perception',
    topic_space_id: null,
  });
  assert.equal(accepted.suggestion.status, 'saved');
  const topicId = accepted.suggestion.saved_item_id;
  assert.ok(
    accepted.map.topic_spaces.some((item) => item.id === topicId && item.category === 'experience'),
  );
  const linked = await api.decideJournalSuggestion(session.api, day, mapEntry.id, {
    accepted: true,
    title: null,
    topic_category: null,
    text: mapEntry.text,
    category: 'practice',
    topic_space_id: topicId,
  });
  assert.equal(linked.suggestion.status, 'saved');
  assert.ok((await api.loadJournalTopics(session.api)).some((item) => item.id === topicId));
  await assert.rejects(
    api.decideJournalSuggestion(session.api, day, topic.id, { accepted: false }),
    (error) => error.status === 409,
  );
  await api.saveJournalEntry(session.api, day, 'Changed analysis source');
  assert.equal((await api.loadJournalEntry(session.api, day)).analysis_stale, true);
  journal = new JournalController(session);
  journal.configure(session.getToken(), true, session.getSnapshot().session.subscription);
  await journal.visit();
  await journal.open(day);
  journal.edit('Safe feature-local controlled draft');
  await journal.flush();
  assert.equal(journal.getSnapshot().dirty, false);
  assert.equal(
    (await api.loadJournalEntry(session.api, day)).content,
    'Safe feature-local controlled draft',
  );
  await setState({ terms_version: 'journal-terms-v2' });
  await session.reload({ force: true });
  assert.equal(session.getSnapshot().session.termsRequired, true);
  await assert.rejects(api.loadJournalEntry(session.api, day), (error) => error.status === 423);
  await acceptTerms(session.api, session.getSnapshot().session.terms.current);
  await session.reload({ force: true });
  assert.equal(
    (await api.loadJournalEntry(session.api, day)).content,
    'Safe feature-local controlled draft',
  );
  const other = await seed('journal-other');
  const otherToken = await login(session.api, { email: other.email, password });
  session.signOut();
  await session.establishSession(otherToken.access_token, session.getSnapshot().session);
  await setState({ email: other.email, premium: true });
  await session.reload({ force: true });
  assert.equal((await api.loadJournalEntry(session.api, day)).content, '');
  console.log(
    'PASS: real Journal authentication/premium/Terms gates, lazy empty day/PUT/history/date/metadata/content limits, mock analysis/real suggestion review/topic links/staleness, controller persistence and user isolation.',
  );
} finally {
  journal?.stop();
  session?.stop();
  await vite.close();
  delete globalThis.localStorage;
}

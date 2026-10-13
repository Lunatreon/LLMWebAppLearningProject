// Only with isolated-registration-server.py --reflection (fresh DB, port 18015).
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const origin = 'http://127.0.0.1:18015',
  storage = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
});
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let session, map, reflection;
try {
  assert.equal((await (await fetch(`${origin}/__contract/fixture`)).json()).isolated, true);
  const { SessionController } = await vite.ssrLoadModule('/src/services/sessionController.ts');
  const { MapController } = await vite.ssrLoadModule('/src/features/map/MapController.ts');
  const { ReflectionController } = await vite.ssrLoadModule(
    '/src/features/reflection/ReflectionController.ts',
  );
  const { practiceSource } = await vite.ssrLoadModule('/src/features/reflection/types.ts');
  const { loadCaptchaConfig, registrationPayload, register } = await vite.ssrLoadModule(
    '/src/features/auth/registration/registrationApi.ts',
  );
  const { loadCurrentTerms, acceptTerms } = await vite.ssrLoadModule(
    '/src/features/terms/termsApi.ts',
  );
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  const mapApi = await vite.ssrLoadModule('/src/features/map/mapApi.ts');
  const journalApi = await vite.ssrLoadModule('/src/features/journal/journalApi.ts');
  session = new SessionController(`${origin}/api/v1`);
  await session.reload();
  const captcha = await loadCaptchaConfig(session.api),
    password = 'Isolated-reflection-password';
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
  const setState = async (payload) =>
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
  await assert.rejects(
    mapApi.updatePractice(session.api, 'missing', 'completed', null),
    (error) => error.status === 401,
  );
  const member = await seed('reflection-contract'),
    token = await login(session.api, { email: member.email, password });
  await session.establishSession(token.access_token, session.getSnapshot().session);
  await assert.rejects(mapApi.loadMap(session.api), (error) => error.status === 402);
  await setState({ email: member.email, premium: true });
  await session.reload({ force: true });
  const topic = (
    await mapApi.createTopic(session.api, {
      title: 'Practice topic',
      category: 'trait',
      description: 'A chosen practice',
      parent_topic_id: null,
      related_topic_ids: [],
      chat_id: null,
    })
  ).topic;
  const original = (
    await mapApi.createEntry(session.api, {
      category: 'practice',
      text: 'Pause before reacting',
      topic_space_id: topic.id,
      source_chat_id: 'synthetic-source-chat',
    })
  ).entry;
  assert.equal(original.status, 'active');
  assert.equal(original.reflection, null);
  map = new MapController(session);
  map.configure(session.getToken(), true, session.getSnapshot().session.subscription);
  await map.visit();
  map.select(topic.id);
  reflection = new ReflectionController(session, map);
  reflection.configure(session.getToken(), true);
  await reflection.open(original.id);
  reflection.edit('  It gave me room to think. \n');
  assert.equal(await reflection.submit(), true);
  let saved = practiceSource(map.getSnapshot().data, original.id);
  assert.equal(saved.status, 'completed');
  assert.equal(saved.reflection, 'It gave me room to think.');
  assert.equal(saved.created_at, original.created_at);
  assert.equal(saved.source_chat_id, original.source_chat_id);
  assert.ok(saved.updated_at);
  assert.equal(map.getSnapshot().selected, topic.id);
  let graph = await mapApi.loadMap(session.api);
  assert.equal(graph.topic_spaces[0].entries.length, 1);
  assert.equal(graph.topic_spaces[0].entries[0].id, original.id);
  // Completed source is readonly in normal UI; backend repeat PATCH replaces the
  // same field/ID, so retry cannot create duplicate Reflection records.
  await reflection.open(original.id, true);
  assert.equal(reflection.getSnapshot().initiallyCompleted, true);
  assert.equal(await reflection.submit(), false);
  await mapApi.updatePractice(session.api, original.id, 'completed', 'Replacement');
  graph = await mapApi.loadMap(session.api);
  assert.equal(graph.topic_spaces[0].entries.length, 1);
  assert.equal(graph.topic_spaces[0].entries[0].reflection, 'Replacement');
  await mapApi.updatePractice(session.api, original.id, 'active');
  assert.equal((await mapApi.loadMap(session.api)).topic_spaces[0].entries[0].reflection, null);
  await mapApi.updatePractice(session.api, original.id, 'paused');
  await reflection.open(original.id, true);
  reflection.edit(' \n\t ');
  assert.equal(await reflection.submit(), true);
  assert.equal(practiceSource(map.getSnapshot().data, original.id).reflection, null);
  await mapApi.updatePractice(session.api, original.id, 'active');
  await reflection.open(original.id, true);
  reflection.edit('x'.repeat(2001));
  assert.equal(await reflection.submit(), false);
  assert.equal(reflection.getSnapshot().answer.length, 2001);
  assert.equal((await mapApi.loadMap(session.api)).topic_spaces[0].entries[0].status, 'active');
  reflection.edit('x'.repeat(2000));
  assert.equal(await reflection.submit(), true);
  assert.equal(practiceSource(map.getSnapshot().data, original.id).reflection.length, 2000);
  const note = (
    await mapApi.createEntry(session.api, {
      category: 'value',
      text: 'A value',
      topic_space_id: null,
      source_chat_id: null,
    })
  ).entry;
  await assert.rejects(
    mapApi.updatePractice(session.api, note.id, 'completed', null),
    (error) => error.status === 404,
  );
  await assert.rejects(
    mapApi.updatePractice(session.api, 'missing', 'completed', null),
    (error) => error.status === 404,
  );
  // Journal-created practice uses exactly the same completion and retains source.
  const day = '2026-10-12';
  await journalApi.saveJournalEntry(
    session.api,
    day,
    'I value honest communication and want to practice pausing before reacting. Writing today helped me notice my preference before discussing a hard decision with my family.',
  );
  const analysed = await journalApi.analyseJournalEntry(session.api, day),
    suggestion = analysed.suggestions.find((item) => item.kind === 'map_entry');
  assert.ok(suggestion);
  const review = await journalApi.decideJournalSuggestion(session.api, day, suggestion.id, {
    accepted: true,
    text: suggestion.text,
    category: 'practice',
    title: null,
    topic_category: null,
    topic_space_id: topic.id,
  });
  const journalPracticeId = review.suggestion.saved_item_id;
  await reflection.open(journalPracticeId, true);
  reflection.edit('A journal-sourced practice reflection');
  assert.equal(await reflection.submit(), true);
  saved = practiceSource(map.getSnapshot().data, journalPracticeId);
  assert.equal(saved.source_journal_date, day);
  assert.equal(saved.reflection, 'A journal-sourced practice reflection');
  assert.equal(
    (await journalApi.loadJournalEntry(session.api, day)).content.includes('honest communication'),
    true,
  );
  await setState({ terms_version: 'reflection-terms-v2' });
  await session.reload({ force: true });
  await assert.rejects(
    mapApi.updatePractice(session.api, original.id, 'completed', null),
    (error) => error.status === 423,
  );
  await acceptTerms(session.api, session.getSnapshot().session.terms.current);
  await session.reload({ force: true });
  await setState({ email: member.email, premium: false });
  await assert.rejects(
    mapApi.updatePractice(session.api, original.id, 'completed', null),
    (error) => error.status === 402,
  );
  await setState({ email: member.email, premium: true });
  const other = await seed('reflection-other'),
    otherToken = await login(session.api, { email: other.email, password });
  session.signOut();
  await session.establishSession(otherToken.access_token, session.getSnapshot().session);
  await setState({ email: other.email, premium: true });
  await session.reload({ force: true });
  await assert.rejects(
    mapApi.updatePractice(session.api, original.id, 'completed', 'Not mine'),
    (error) => error.status === 404,
  );
  console.log(
    'PASS: atomic Practice/Reflection completion, exact PATCH/null/trim/max/DTO/source metadata, readonly/repeat/reactivate/paused semantics, canonical Map integration, Journal source preservation, 401/402/423/404 and user isolation. No separate Reflection entity or endpoint.',
  );
} finally {
  reflection?.stop();
  map?.stop();
  session?.stop();
  await vite.close();
  delete globalThis.localStorage;
}

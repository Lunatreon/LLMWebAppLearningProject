// Run only with isolated-registration-server.py --map (disposable DB, port 18014).
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const origin = 'http://127.0.0.1:18014';
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
let session, controller;
try {
  assert.equal((await (await fetch(`${origin}/__contract/fixture`)).json()).isolated, true);
  const { SessionController } = await vite.ssrLoadModule('/src/services/sessionController.ts');
  const { MapController } = await vite.ssrLoadModule('/src/features/map/MapController.ts');
  const { hasMapAccess } = await vite.ssrLoadModule('/src/services/capabilities.ts');
  const { loadCaptchaConfig, registrationPayload, register } = await vite.ssrLoadModule(
    '/src/features/auth/registration/registrationApi.ts',
  );
  const { loadCurrentTerms, acceptTerms } = await vite.ssrLoadModule(
    '/src/features/terms/termsApi.ts',
  );
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  const mapApi = await vite.ssrLoadModule('/src/features/map/mapApi.ts');
  session = new SessionController(`${origin}/api/v1`);
  await session.reload();
  const captcha = await loadCaptchaConfig(session.api);
  const password = 'Isolated-map-password';
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
  await assert.rejects(mapApi.loadMap(session.api), (error) => error.status === 401);
  const user = await seed('map-contract');
  const loginResult = await login(session.api, { email: user.email, password });
  await session.establishSession(loginResult.access_token, session.getSnapshot().session);
  assert.equal(hasMapAccess(session.getSnapshot().session.subscription), false);
  await assert.rejects(mapApi.loadMap(session.api), (error) => error.status === 402);
  await setState({ email: user.email, premium: true });
  await session.reload({ force: true });
  assert.equal(hasMapAccess(session.getSnapshot().session.subscription), true);
  assert.deepEqual((await mapApi.loadMap(session.api)).topic_spaces, []);
  const make = (title, fields = {}) =>
    mapApi.createTopic(session.api, {
      title,
      category: 'other',
      description: 'A note',
      parent_topic_id: null,
      related_topic_ids: [],
      chat_id: null,
      ...fields,
    });
  const parent = (await make('  Family  ', { category: 'person' })).topic;
  assert.match(parent.id, /^[0-9a-f]{32}$/);
  assert.equal(parent.title, 'Family');
  assert.ok(parent.created_at);
  assert.equal('position' in parent, false);
  const child = (
    await make('Rest', {
      category: 'experience',
      parent_topic_id: parent.id,
      related_topic_ids: [parent.id, parent.id],
    })
  ).topic;
  let graph = await mapApi.loadMap(session.api);
  assert.deepEqual(graph.topic_spaces.find((topic) => topic.id === child.id).related_topic_ids, [
    parent.id,
  ]);
  assert.deepEqual(graph.topic_spaces.find((topic) => topic.id === parent.id).related_topic_ids, [
    child.id,
  ]);
  await assert.rejects(
    mapApi.updateTopic(session.api, parent.id, { parent_topic_id: child.id }),
    (error) => error.status === 400 && /cycle/.test(error.message),
  );
  await assert.rejects(
    mapApi.updateTopic(session.api, parent.id, { related_topic_ids: [parent.id] }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    mapApi.updateTopic(session.api, parent.id, { parent_topic_id: parent.id }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    mapApi.updateTopic(session.api, parent.id, { related_topic_ids: ['missing'] }),
    (error) => error.status === 404,
  );
  await assert.rejects(make('x'.repeat(121)), (error) => error.status === 422);
  const reused = await make('family', { category: 'trait', description: 'Updated by name reuse' });
  assert.equal(reused.topic.id, parent.id);
  await mapApi.updateTopic(session.api, parent.id, {
    category: 'person',
    description: 'D'.repeat(1500),
  });
  graph = await mapApi.loadMap(session.api);
  assert.equal(graph.topic_spaces.find((topic) => topic.id === parent.id).description.length, 1500);
  const note = (
    await mapApi.createEntry(session.api, {
      category: 'value',
      text: '  Honesty matters  ',
      topic_space_id: parent.id,
      source_chat_id: null,
    })
  ).entry;
  assert.equal(note.text, 'Honesty matters');
  assert.ok(note.created_at);
  const practice = (
    await mapApi.createEntry(session.api, {
      category: 'practice',
      text: 'Pause',
      topic_space_id: null,
      source_chat_id: null,
    })
  ).entry;
  assert.equal(practice.status, 'active');
  await mapApi.updatePractice(session.api, practice.id, 'paused');
  await mapApi.updatePractice(session.api, practice.id, 'active');
  await assert.rejects(
    mapApi.updatePractice(session.api, note.id, 'paused'),
    (error) => error.status === 404,
  );
  await assert.rejects(
    mapApi.createEntry(session.api, {
      category: 'value',
      text: 'x'.repeat(1001),
      topic_space_id: null,
      source_chat_id: null,
    }),
    (error) => error.status === 422,
  );
  await mapApi.updateEntry(session.api, note.id, {
    category: 'evidence',
    text: 'I paused',
    topic_space_id: child.id,
  });
  graph = await mapApi.loadMap(session.api);
  assert.equal(graph.topic_spaces.find((topic) => topic.id === parent.id).entries.length, 0);
  assert.equal(graph.topic_spaces.find((topic) => topic.id === child.id).entries[0].id, note.id);
  await mapApi.updateTopic(session.api, child.id, { parent_topic_id: null, related_topic_ids: [] });
  graph = await mapApi.loadMap(session.api);
  assert.deepEqual(
    graph.topic_spaces.find((topic) => topic.id === parent.id).related_topic_ids,
    [],
  );
  await mapApi.mergeTopic(session.api, child.id, parent.id);
  graph = await mapApi.loadMap(session.api);
  assert.equal(graph.topic_spaces.length, 1);
  assert.ok(
    graph.topic_spaces[0].entries.some(
      (entry) => entry.category === 'merged_topic' && entry.source_topic_id === child.id,
    ),
  );
  await assert.rejects(
    mapApi.mergeTopic(session.api, parent.id, parent.id),
    (error) => error.status === 400,
  );
  await mapApi.deleteEntry(session.api, practice.id);
  await assert.rejects(
    mapApi.deleteEntry(session.api, practice.id),
    (error) => error.status === 404,
  );
  await mapApi.deleteTopic(session.api, parent.id);
  graph = await mapApi.loadMap(session.api);
  assert.equal(graph.topic_spaces.length, 0);
  assert.ok(graph.unassigned_entries.some((entry) => entry.id === note.id));
  await assert.rejects(
    mapApi.updateTopic(session.api, 'missing', { title: 'Missing' }),
    (error) => error.status === 404,
  );
  controller = new MapController(session);
  controller.configure(session.getToken(), true, session.getSnapshot().session.subscription);
  await controller.visit();
  const linkedId = (await make('Reviewed topic')).topic.id;
  // Serialize overlapping full-profile writes and retain both edits.
  const extra = (await make('Extra')).topic;
  await Promise.all([
    mapApi.updateTopic(session.api, linkedId, { title: 'Reviewed topic updated' }),
    mapApi.updateTopic(session.api, extra.id, { title: 'Extra updated' }),
  ]);
  graph = await mapApi.loadMap(session.api);
  assert.ok(graph.topic_spaces.some((topic) => topic.title === 'Reviewed topic updated'));
  assert.ok(graph.topic_spaces.some((topic) => topic.title === 'Extra updated'));
  await setState({ terms_version: 'map-terms-v2' });
  await session.reload({ force: true });
  assert.equal(session.getSnapshot().session.termsRequired, true);
  await assert.rejects(mapApi.loadMap(session.api), (error) => error.status === 423);
  await acceptTerms(session.api, session.getSnapshot().session.terms.current);
  await session.reload({ force: true });
  assert.ok((await mapApi.loadMap(session.api)).topic_spaces.length);
  const other = await seed('map-other');
  const otherLogin = await login(session.api, { email: other.email, password });
  session.signOut();
  await session.establishSession(otherLogin.access_token, session.getSnapshot().session);
  await setState({ email: other.email, premium: true });
  await session.reload({ force: true });
  assert.deepEqual((await mapApi.loadMap(session.api)).topic_spaces, []);
  await assert.rejects(
    mapApi.updateTopic(session.api, linkedId, { title: 'Not mine' }),
    (error) => error.status === 404,
  );
  console.log(
    'PASS: real Map auth/premium/Terms/user isolation, topic/hierarchy/symmetric links/merge/delete, entry/practice CRUD/validation/metadata, serialized writes. No position/drag/zoom API exists or was added.',
  );
} finally {
  controller?.stop();
  session?.stop();
  await vite.close();
  delete globalThis.localStorage;
}

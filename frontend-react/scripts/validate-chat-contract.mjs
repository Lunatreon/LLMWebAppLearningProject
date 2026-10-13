// Only with isolated-registration-server.py --chat (fresh disposable DB, 18016).
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const origin = 'http://127.0.0.1:18016',
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
let session, map, chat;
try {
  assert.equal((await (await fetch(`${origin}/__contract/fixture`)).json()).isolated, true);
  const { SessionController } = await vite.ssrLoadModule('/src/services/sessionController.ts');
  const { MapController } = await vite.ssrLoadModule('/src/features/map/MapController.ts');
  const { ChatController } = await vite.ssrLoadModule('/src/features/chat/ChatController.ts');
  const { loadCaptchaConfig, registrationPayload, register } = await vite.ssrLoadModule(
    '/src/features/auth/registration/registrationApi.ts',
  );
  const { loadCurrentTerms, acceptTerms } = await vite.ssrLoadModule(
    '/src/features/terms/termsApi.ts',
  );
  const { login } = await vite.ssrLoadModule('/src/features/auth/authApi.ts');
  const api = await vite.ssrLoadModule('/src/features/chat/chatApi.ts'),
    mapApi = await vite.ssrLoadModule('/src/features/map/mapApi.ts');
  session = new SessionController(`${origin}/api/v1`);
  await session.reload();
  const captcha = await loadCaptchaConfig(session.api),
    password = 'Isolated-chat-password';
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
  await assert.rejects(api.loadConversations(session.api), (error) => error.status === 401);
  const user = await seed('chat-contract'),
    token = await login(session.api, { email: user.email, password });
  await session.establishSession(token.access_token, session.getSnapshot().session);
  assert.deepEqual(await api.loadConversations(session.api), []);
  assert.equal(session.getSnapshot().session.subscription.my_map_access, false);
  const first = await api.createConversation(session.api, new AbortController().signal);
  assert.match(first.chat_id, /^[0-9a-f]{32}$/);
  assert.equal(first.message_count, 0);
  assert.deepEqual(first.messages, []);
  const freeTopic = {
    chat_id: first.chat_id,
    require_map_access: true,
    suggestion_id: null,
    entry_category: 'own_perception',
    topic: 'Capability contract',
    description: 'Synthetic proposal',
    category: 'other',
    related_topic_ids: [],
    accepted: true,
    existing_topic_space_id: null,
    parent_topic_space_id: null,
  };
  const freeNote = {
    chat_id: first.chat_id,
    accepted: true,
    category: 'value',
    text: 'Synthetic chosen note',
    reason: 'Capability contract',
    topic_space_id: null,
  };
  await assert.rejects(api.decideTopic(session.api, freeTopic), (error) => error.status === 402);
  await assert.rejects(api.decideNote(session.api, freeNote), (error) => error.status === 402);
  assert.equal(
    (await api.decideTopic(session.api, { ...freeTopic, accepted: false })).accepted,
    false,
  );
  assert.equal(
    (await api.decideNote(session.api, { ...freeNote, accepted: false })).accepted,
    false,
  );
  const prompt =
    'My parents tell me to choose safety and obedience. I want to notice my own preference and pause before reacting when I feel judged. This keeps showing up in my body and I want to understand my choices.';
  let deltas = '';
  const result = await api.generate(
    session.api,
    first.chat_id,
    prompt,
    new AbortController().signal,
    (text) => {
      deltas += text;
    },
  );
  assert.ok(deltas);
  assert.equal(result.chat_id, first.chat_id);
  assert.equal(result.chat_info.messages.length, 2);
  assert.equal(result.chat_info.messages[0].role, 'user');
  assert.equal(result.chat_info.messages[0].content, prompt);
  assert.equal(result.chat_info.messages[1].content, result.assistant_message);
  assert.equal(result.chat_info.messages[0].created_at, result.chat_info.messages[1].created_at);
  let history = await api.loadConversation(session.api, first.chat_id);
  assert.equal(history.message_count, 1);
  assert.equal(history.messages.length, 2);
  assert.equal(
    await api.react(session.api, first.chat_id, history.messages[1].created_at, 'like'),
    'like',
  );
  assert.equal(
    (await api.loadConversation(session.api, first.chat_id)).messages[1].reaction,
    'like',
  );
  await api.react(session.api, first.chat_id, history.messages[1].created_at, null);
  await assert.rejects(
    api.react(session.api, first.chat_id, 'missing', 'like'),
    (error) => error.status === 404,
  );
  await api.generate(
    session.api,
    first.chat_id,
    'Another observation',
    new AbortController().signal,
    () => {},
  );
  await assert.rejects(
    api.generate(
      session.api,
      first.chat_id,
      'Exceeds free quota',
      new AbortController().signal,
      () => {},
    ),
    (error) => error.status === 429 && /free messages/.test(error.message),
  );
  await setState({ email: user.email, premium: true });
  await session.reload({ force: true });
  map = new MapController(session);
  map.configure(session.getToken(), true, session.getSnapshot().session.subscription);
  await map.load();
  chat = new ChatController(session, map);
  chat.configure(session.getToken(), true, true);
  chat.setVisible(true, true);
  await chat.loadList();
  await chat.select(first.chat_id);
  const analysis = await api.loadAnalysis(session.api, first.chat_id);
  assert.ok(['idle', 'topic_ready', 'queued', 'analysing'].includes(analysis.analysis_status));
  // Real typed topic/link payload and authoritative source metadata. If current
  // analysis offers a topic use its ID; otherwise legacy schema accepts manual
  // no-suggestion-ID confirmation of this synthetic chat.
  const suggestion = analysis.suggestions?.[0] || analysis.suggestion;
  const decision = {
    chat_id: first.chat_id,
    require_map_access: true,
    suggestion_id: suggestion?.suggestion_id || null,
    entry_category: 'own_perception',
    topic: 'Contract source topic',
    description: 'Chosen source description',
    category: 'experience',
    related_topic_ids: [],
    accepted: true,
    existing_topic_space_id: null,
    parent_topic_space_id: null,
  };
  const saved = await api.decideTopic(session.api, decision);
  assert.ok(saved.saved_topic_space_id);
  map.acceptExternal(saved.profile.self_authorship_map, saved.commitVersion);
  let graph = await mapApi.loadMap(session.api);
  assert.ok(
    graph.topic_spaces
      .find((topic) => topic.id === saved.saved_topic_space_id)
      .chat_ids.includes(first.chat_id),
  );
  if (suggestion?.suggestion_id)
    await assert.rejects(api.decideTopic(session.api, decision), (error) => error.status === 409);
  const linked = await api.decideTopic(session.api, {
    ...decision,
    suggestion_id: null,
    topic: 'Detected aspect',
    description: 'Saved source note',
    category: 'trait',
    entry_category: 'evidence',
    existing_topic_space_id: saved.saved_topic_space_id,
  });
  assert.equal(linked.saved_topic_space_id, saved.saved_topic_space_id);
  graph = await mapApi.loadMap(session.api);
  assert.ok(
    graph.topic_spaces[0].entries.some(
      (entry) => entry.source_chat_id === first.chat_id && entry.text === 'Saved source note',
    ),
  );
  const note = await api.decideNote(session.api, {
    chat_id: first.chat_id,
    accepted: true,
    category: 'practice',
    text: 'Pause before reacting',
    reason: 'Synthetic chosen note',
    topic_space_id: saved.saved_topic_space_id,
  });
  assert.equal(note.accepted, true);
  assert.ok(
    note.map.topic_spaces[0].entries.some(
      (entry) => entry.category === 'practice' && entry.source_chat_id === first.chat_id,
    ),
  );
  map.setChatSource(first.chat_id);
  await map.saveEntry(
    {
      category: 'value',
      text: 'Manual source-aware entry',
      topic_space_id: saved.saved_topic_space_id,
    },
    saved.saved_topic_space_id,
  );
  assert.ok(
    map
      .getSnapshot()
      .data.topic_spaces[0].entries.some(
        (entry) =>
          entry.text === 'Manual source-aware entry' && entry.source_chat_id === first.chat_id,
      ),
  );
  // Slow mock transport only: real stream/transaction/abort/gating stay unchanged.
  const second = await api.createConversation(session.api, new AbortController().signal);
  await setState({ chat_delay_ms: 300 });
  let statusSeen = false;
  const stopped = new AbortController();
  await assert.rejects(
    session.api.stream(
      '/llm/message/stream',
      {
        authenticated: true,
        method: 'POST',
        body: JSON.stringify({
          chat_id: second.chat_id,
          context: 'Will be cancelled before mock provider responds',
        }),
        signal: stopped.signal,
      },
      (event) => {
        if (event.type === 'status') {
          statusSeen = true;
          stopped.abort();
        }
      },
    ),
    (error) => error.name === 'AbortError',
  );
  assert.equal(statusSeen, true);
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal((await api.loadConversation(session.api, second.chat_id)).messages.length, 0);
  // Map edits during real generation must survive the backend's profile merge.
  const running = api.generate(
    session.api,
    second.chat_id,
    'A concurrent reflection',
    new AbortController().signal,
    () => {},
  );
  await mapApi.updateTopic(session.api, saved.saved_topic_space_id, {
    title: 'Source topic edited during chat',
  });
  await running;
  graph = await mapApi.loadMap(session.api);
  assert.equal(
    graph.topic_spaces.find((topic) => topic.id === saved.saved_topic_space_id).title,
    'Source topic edited during chat',
  );
  await setState({ chat_delay_ms: 0 });
  history = await api.loadConversation(session.api, second.chat_id);
  assert.equal(history.messages.length, 2);
  assert.equal((await api.loadConversations(session.api))[0].chat_id, second.chat_id);
  await api.retryAnalysis(session.api, second.chat_id);
  assert.equal((await api.loadConversation(session.api, second.chat_id)).messages.length, 2);
  await assert.rejects(
    api.generate(
      session.api,
      second.chat_id,
      'x'.repeat(8001),
      new AbortController().signal,
      () => {},
    ),
    (error) => error.status === 422,
  );
  assert.equal((await api.loadConversation(session.api, second.chat_id)).messages.length, 2);
  await setState({ chat_minute_limit: 1 });
  await api.generate(
    session.api,
    second.chat_id,
    'Within minute limit',
    new AbortController().signal,
    () => {},
  );
  await assert.rejects(
    api.generate(session.api, second.chat_id, 'Too soon', new AbortController().signal, () => {}),
    (error) =>
      error.status === 429 &&
      /too quickly/.test(error.message) &&
      !/free messages/.test(error.message),
  );
  assert.equal((await api.loadConversation(session.api, second.chat_id)).messages.length, 4);
  await setState({ chat_minute_limit: 1000 });
  await setState({ terms_version: 'chat-terms-v2' });
  await session.reload({ force: true });
  await assert.rejects(api.loadConversations(session.api), (error) => error.status === 423);
  await acceptTerms(session.api, session.getSnapshot().session.terms.current);
  await session.reload({ force: true });
  await api.deleteConversation(session.api, second.chat_id);
  await assert.rejects(
    api.loadConversation(session.api, second.chat_id),
    (error) => error.status === 404,
  );
  assert.ok((await mapApi.loadMap(session.api)).topic_spaces[0].chat_ids.includes(first.chat_id));
  const other = await seed('chat-other'),
    otherLogin = await login(session.api, { email: other.email, password });
  session.signOut();
  await session.establishSession(otherLogin.access_token, session.getSnapshot().session);
  assert.deepEqual(await api.loadConversations(session.api), []);
  await assert.rejects(
    api.loadConversation(session.api, first.chat_id),
    (error) => error.status === 404,
  );
  await assert.rejects(
    api.deleteConversation(session.api, first.chat_id),
    (error) => error.status === 404,
  );
  console.log(
    'PASS: real history/create/detail/delete/reactions, NDJSON/status/delta/result/persisted ordering, abort before commit, quota/Terms/auth/isolation, source topic/note/manual Map links and Map edits during generation. No rename or automatic resend endpoint was added.',
  );
} finally {
  chat?.stop();
  map?.stop();
  session?.stop();
  await vite.close();
  delete globalThis.localStorage;
}

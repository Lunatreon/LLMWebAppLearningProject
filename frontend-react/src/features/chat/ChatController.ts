import { ApiError } from '../../services/apiClient';
import type { SessionController } from '../../services/sessionController';
import type { MapController } from '../map/MapController';
import * as api from './chatApi';
import { createTextPlayer } from './textPlayer';
import type {
  ChatSnapshot,
  ChatConversation,
  GenerationView,
  TopicDecision,
  NoteDecision,
  Reaction,
} from './types';
type Request = GenerationView & {
  owner: string;
  navigation: number;
  baseCount: number;
  controller: AbortController;
  player: ReturnType<typeof createTextPlayer> | null;
};
const empty = (): ChatSnapshot => ({
  enabled: false,
  mapAccess: false,
  active: null,
  chats: [],
  draft: '',
  loading: false,
  listLoading: false,
  listNextCursor: null,
  historyLoading: false,
  listError: '',
  error: '',
  errorStatus: null,
  generation: null,
  review: null,
  reviewPending: false,
  analysisStatus: 'idle',
  retryPending: false,
  retryError: false,
  menu: null,
  deleting: null,
  confirmation: null,
  reactionPending: [],
  focusVersion: 0,
  scrollVersion: 0,
  preflight: false,
});
export class ChatController {
  private owner: string | null = null;
  private alive = true;
  private visible = false;
  private instant = false;
  private initialized = false;
  private navigation = 0;
  private listRequest = 0;
  private analysisRequest = 0;
  private draftRevision = 0;
  private sequence = 0;
  private version = 0;
  private versions = new Map<string, number>();
  private changes: { version: number; id: string; removed?: boolean; move: boolean }[] = [];
  private tombstones = new Set<string>();
  private failed = new Map<string, { context: string; baseCount: number; error: string }>();
  private request: Request | null = null;
  private reader: AbortController | null = null;
  private historyReader: AbortController | null = null;
  private listReader: AbortController | null = null;
  private pollReader: AbortController | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snapshot = empty();
  constructor(
    private readonly session: SessionController,
    private readonly map?: MapController,
  ) {}
  getSnapshot = () => this.snapshot;
  isOwnedBy = (token: string | null) => token !== null && token === this.owner;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };
  private current(owner: string | null) {
    return (
      this.alive && owner !== null && owner === this.owner && owner === this.session.getToken()
    );
  }
  private emit(change: Partial<ChatSnapshot> = {}) {
    const q = this.request;
    this.snapshot = {
      ...this.snapshot,
      ...change,
      generation: q
        ? {
            id: q.id,
            chatId: q.chatId,
            context: q.context,
            text: q.text,
            shown: q.shown,
            chunks: [...q.chunks],
          }
        : null,
    };
    this.listeners.forEach((notify) => notify());
  }
  private touch(id: string, move = false, removed = false) {
    this.versions.set(id, (this.versions.get(id) || 0) + 1);
    this.changes.push({ version: ++this.version, id, removed, move });
  }
  private chat(id = this.snapshot.active) {
    return this.snapshot.chats.find((chat) => chat.chat_id === id);
  }
  private upsert(chat: ChatConversation, move = true) {
    if (this.tombstones.has(chat.chat_id)) return;
    const old = this.chat(chat.chat_id);
    if (
      old?.messages.length &&
      chat.messages.length &&
      old.messages.every((m) => m.position !== undefined) &&
      chat.messages.every((m) => m.position !== undefined)
    ) {
      const merged = new Map(old.messages.map((m) => [`${m.position}:${m.role}`, m]));
      chat.messages.forEach((m) => merged.set(`${m.position}:${m.role}`, m));
      chat = {
        ...chat,
        messages: [...merged.values()].sort(
          (a, b) => a.position! - b.position! || (a.role === 'user' ? -1 : 1),
        ),
        next_before_position:
          old.messages[0].position! < chat.messages[0].position!
            ? old.next_before_position
            : chat.next_before_position,
      };
    }
    this.touch(chat.chat_id, move);
    const chats = this.snapshot.chats.filter((item) => item.chat_id !== chat.chat_id);
    if (move) chats.unshift(chat);
    else {
      const index = this.snapshot.chats.findIndex((item) => item.chat_id === chat.chat_id);
      chats.splice(index < 0 ? chats.length : index, 0, chat);
    }
    this.emit({ chats });
  }
  private error(error: unknown) {
    this.emit({
      error: error instanceof Error ? error.message : 'Request failed',
      errorStatus: error instanceof ApiError ? error.status : 0,
    });
  }
  configure(owner: string | null, enabled: boolean, mapAccess: boolean) {
    const restarting = !this.alive;
    this.alive = true;
    if (owner !== this.owner) {
      this.cancel();
      this.owner = owner;
      this.initialized = false;
      this.tombstones.clear();
      this.failed.clear();
      this.versions.clear();
      this.changes = [];
      this.version = 0;
      this.snapshot = empty();
      this.request = null;
    }
    const was = this.snapshot.enabled;
    this.emit({
      enabled: Boolean(owner && enabled),
      mapAccess,
      ...(!mapAccess && this.snapshot.review === 'note' ? { review: null } : {}),
    });
    if (!enabled) this.stopPolling();
    if (this.snapshot.enabled && (!this.initialized || restarting)) {
      this.initialized = true;
      void this.loadList();
    } else if (!was && this.snapshot.enabled && this.snapshot.active) void this.poll();
  }
  setVisible(visible: boolean, instant = false) {
    if (this.visible === visible && this.instant === instant) return;
    this.visible = visible;
    this.instant = instant;
    this.resetPlayer();
    this.emit();
  }
  private resetPlayer() {
    const q = this.request;
    if (!q) return;
    q.player?.cancel();
    q.player = null;
    if (!this.visible || this.snapshot.active !== q.chatId) return;
    q.shown = q.text;
    q.chunks = q.text ? [q.text] : [];
    q.player = createTextPlayer(
      (text) => {
        if (
          this.request === q &&
          this.current(q.owner) &&
          this.snapshot.active === q.chatId &&
          this.visible
        ) {
          q.shown += text;
          q.chunks.push(text);
          this.emit();
        }
      },
      () => this.instant,
    );
  }
  edit(draft: string) {
    if (!this.current(this.owner)) return;
    this.draftRevision++;
    this.emit({ draft });
  }
  prompt(text: string) {
    this.edit(text);
    this.emit({ focusVersion: this.snapshot.focusVersion + 1 });
  }
  newConversation() {
    if (!this.current(this.owner)) return;
    this.navigation++;
    this.reader?.abort();
    this.historyReader?.abort();
    this.stopPolling();
    this.emit({
      active: null,
      historyLoading: false,
      review: null,
      loading: false,
      error: '',
      errorStatus: null,
      analysisStatus: 'idle',
      focusVersion: this.snapshot.focusVersion + 1,
      retryError: false,
      scrollVersion: this.snapshot.scrollVersion + 1,
    });
    this.map?.setChatSource(null);
    this.resetPlayer();
  }
  async loadList(append = false) {
    if (append && !this.snapshot.listNextCursor) return;
    if (!this.snapshot.enabled || !this.current(this.owner)) return;
    this.listReader?.abort();
    const reader = new AbortController();
    this.listReader = reader;
    const owner = this.owner,
      request = ++this.listRequest,
      version = this.version,
      versions = new Map(this.versions);
    this.emit({ listLoading: true, listError: '' });
    try {
      const page = await api.loadConversationPage(
        this.session.api,
        reader.signal,
        append ? this.snapshot.listNextCursor || undefined : undefined,
      );
      let chats = page.items;
      if (append) chats = [...this.snapshot.chats, ...chats.filter((c) => !this.chat(c.chat_id))];
      if (!this.current(owner) || request !== this.listRequest || reader.signal.aborted) return;
      chats = chats
        .filter((chat) => !this.tombstones.has(chat.chat_id))
        .map((chat) => {
          const changedSinceRead = this.versions.get(chat.chat_id) !== versions.get(chat.chat_id);
          const hasActiveGeneration = this.request?.chatId === chat.chat_id;
          if (changedSinceRead || hasActiveGeneration) {
            return this.chat(chat.chat_id) || chat;
          }
          const cached = this.chat(chat.chat_id);
          return cached
            ? {
                ...chat,
                messages: cached.messages,
                next_before_position: cached.next_before_position,
              }
            : chat;
        });
      for (const change of this.changes.filter((change) => change.version > version)) {
        if (change.removed) chats = chats.filter((chat) => chat.chat_id !== change.id);
        else if (change.move) {
          const chat = this.chat(change.id);
          if (chat) {
            chats = chats.filter((item) => item.chat_id !== change.id);
            chats.unshift(chat);
          }
        }
      }
      this.emit({ chats, listError: '', listNextCursor: page.next_cursor });
    } catch (error) {
      if (this.current(owner) && request === this.listRequest && !reader.signal.aborted)
        this.emit({
          listError: error instanceof Error ? error.message : 'Could not load conversations.',
        });
    } finally {
      if (this.current(owner) && request === this.listRequest) this.emit({ listLoading: false });
    }
  }
  async select(id: string): Promise<boolean> {
    if (!this.snapshot.enabled || !this.current(this.owner) || this.tombstones.has(id))
      return false;
    const owner = this.owner,
      navigation = ++this.navigation,
      version = this.versions.get(id);
    this.reader?.abort();
    this.historyReader?.abort();
    this.stopPolling();
    const reader = new AbortController();
    this.reader = reader;
    this.emit({
      active: id,
      loading: true,
      historyLoading: false,
      retryError: false,
      review: null,
      error: '',
      errorStatus: null,
      analysisStatus: 'idle',
    });
    this.map?.setChatSource(id);
    this.resetPlayer();
    try {
      const chat = await api.loadConversation(this.session.api, id, reader.signal);
      if (
        !this.current(owner) ||
        navigation !== this.navigation ||
        reader.signal.aborted ||
        this.tombstones.has(id)
      )
        return false;
      if (version === this.versions.get(id) && this.request?.chatId !== id)
        this.upsert(chat, false);
      if (this.failed.has(id) && !this.snapshot.draft && !this.request) {
        const failure = this.failed.get(id)!;
        this.emit({ draft: failure.context, error: failure.error });
      }
      this.emit({ scrollVersion: this.snapshot.scrollVersion + 1 });
      this.resetPlayer();
      void this.poll();
      return true;
    } catch (error) {
      if (this.current(owner) && navigation === this.navigation && !reader.signal.aborted)
        this.error(error);
      return false;
    } finally {
      if (this.current(owner) && navigation === this.navigation) this.emit({ loading: false });
    }
  }
  async loadOlder() {
    const chat = this.chat();
    if (!chat?.next_before_position || this.snapshot.historyLoading || !this.current(this.owner))
      return;
    const owner = this.owner,
      navigation = this.navigation,
      version = this.versions.get(chat.chat_id);
    const reader = new AbortController();
    this.historyReader?.abort();
    this.historyReader = reader;
    this.emit({ historyLoading: true });
    try {
      const page = await api.loadConversation(
        this.session.api,
        chat.chat_id,
        reader.signal,
        chat.next_before_position,
      );
      if (
        !this.current(owner) ||
        reader.signal.aborted ||
        navigation !== this.navigation ||
        version !== this.versions.get(chat.chat_id)
      )
        return;
      this.upsert({ ...page, messages: [...page.messages, ...chat.messages] }, false);
    } catch (error) {
      if (this.current(owner) && navigation === this.navigation && !reader.signal.aborted)
        this.error(error);
    } finally {
      if (this.current(owner) && navigation === this.navigation)
        this.emit({ historyLoading: false });
    }
  }
  async send() {
    if (!this.snapshot.enabled || !this.current(this.owner) || this.snapshot.preflight)
      return false;
    if (this.request) {
      if (this.request.chatId === this.snapshot.active) this.request.controller.abort();
      return false;
    }
    const context = this.snapshot.draft.trim();
    if (!context || this.snapshot.loading) return false;
    const owner = this.owner!,
      chatId = this.snapshot.active,
      navigation = this.navigation,
      draftRevision = this.draftRevision;
    // Reconcile an uncertain previous attempt before an explicit identical resend.
    // Backend has no idempotency key; never automatically replay generation.
    const failure = chatId ? this.failed.get(chatId) : null;
    if (failure?.context === context) {
      const version = this.versions.get(chatId!);
      this.emit({ preflight: true });
      try {
        const chat = await api.loadConversation(this.session.api, chatId!);
        if (!this.current(owner) || navigation !== this.navigation || this.request) return false;
        if (version !== this.versions.get(chatId!)) {
          this.error(
            new ApiError('The conversation changed. Please check it before sending again.', 409),
          );
          return false;
        }
        const pair = chat.messages.slice(-2);
        if (
          chat.message_count === failure.baseCount + 1 &&
          pair[0]?.role === 'user' &&
          pair[0].content === context &&
          pair[1]?.role === 'assistant'
        ) {
          this.upsert(chat);
          this.failed.delete(chatId!);
          this.emit({
            error: '',
            errorStatus: null,
            ...(draftRevision === this.draftRevision ? { draft: '' } : {}),
            scrollVersion: this.snapshot.scrollVersion + 1,
          });
          void this.poll();
          return true;
        }
        this.upsert(chat, false);
      } catch (error) {
        if (this.current(owner) && navigation === this.navigation) this.error(error);
        return false;
      } finally {
        if (this.current(owner)) this.emit({ preflight: false });
      }
    }
    if (
      !this.current(owner) ||
      navigation !== this.navigation ||
      this.request ||
      draftRevision !== this.draftRevision
    )
      return false;
    const q: Request = {
      id: ++this.sequence,
      owner,
      chatId,
      navigation,
      context,
      text: '',
      shown: '',
      chunks: [],
      controller: new AbortController(),
      player: null,
      baseCount: this.chat()?.message_count || 0,
    };
    this.request = q;
    this.emit({
      draft: '',
      error: '',
      errorStatus: null,
      scrollVersion: this.snapshot.scrollVersion + 1,
    });
    try {
      if (!q.chatId) {
        const created = await api.createConversation(this.session.api, q.controller.signal);
        if (!this.current(owner) || this.request !== q || q.controller.signal.aborted) return false;
        q.chatId = created.chat_id;
        this.upsert(created);
        if (this.snapshot.active === null && this.navigation === navigation) {
          this.emit({ active: created.chat_id });
          this.map?.setChatSource(created.chat_id);
        }
      }
      if (this.tombstones.has(q.chatId)) return false;
      this.touch(q.chatId);
      this.resetPlayer();
      this.emit();
      const result = await api.generate(
        this.session.api,
        q.chatId,
        context,
        q.controller.signal,
        (text) => {
          if (!this.current(owner) || this.request !== q || this.tombstones.has(q.chatId!)) return;
          q.text += text;
          if (this.visible && this.snapshot.active === q.chatId) q.player?.push(text);
        },
      );
      if (
        !this.current(owner) ||
        this.request !== q ||
        q.controller.signal.aborted ||
        this.tombstones.has(q.chatId)
      )
        return false;
      q.player?.finish();
      this.upsert(api.resultConversation(result));
      this.failed.delete(q.chatId);
      this.request = null;
      this.emit();
      if (this.snapshot.active === q.chatId) {
        this.emit({ scrollVersion: this.snapshot.scrollVersion + 1 });
        this.schedulePoll();
      }
      return true;
    } catch (error) {
      if (this.current(owner) && this.request === q && !this.tombstones.has(q.chatId || '')) {
        let message = 'Request failed';
        if (q.controller.signal.aborted) {
          message = 'Response stopped.';
        } else if (error instanceof Error) {
          message = error.message;
        }
        if (q.chatId)
          this.failed.set(q.chatId, { context, baseCount: q.baseCount, error: message });
        if (
          this.snapshot.active === q.chatId &&
          (q.chatId !== null || this.navigation === q.navigation)
        ) {
          if (!this.snapshot.draft) this.emit({ draft: context });
          if (!q.controller.signal.aborted) this.error(error);
        }
      }
      return false;
    } finally {
      q.player?.cancel();
      if (this.request === q) {
        this.request = null;
        this.emit();
      }
    }
  }
  stopResponse() {
    if (this.request?.chatId === this.snapshot.active) this.request.controller.abort();
  }
  private stopPolling() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollReader?.abort();
    this.analysisRequest++;
  }
  private schedulePoll(attempt = 0) {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (!this.snapshot.enabled || !this.snapshot.active || !this.current(this.owner)) return;
    const id = this.snapshot.active;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.poll(attempt, id);
    }, [700, 1800, 4000, 8000][Math.min(attempt, 3)]);
  }
  async poll(attempt = -1, expectedId = this.snapshot.active) {
    if (
      !expectedId ||
      !this.snapshot.enabled ||
      expectedId !== this.snapshot.active ||
      !this.current(this.owner)
    )
      return;
    const owner = this.owner,
      request = ++this.analysisRequest,
      version = this.versions.get(expectedId),
      reader = new AbortController();
    this.pollReader?.abort();
    this.pollReader = reader;
    try {
      const result = await api.loadAnalysis(this.session.api, expectedId, reader.signal);
      if (
        !this.current(owner) ||
        request !== this.analysisRequest ||
        expectedId !== this.snapshot.active ||
        reader.signal.aborted ||
        this.tombstones.has(expectedId)
      )
        return;
      const stale = version !== this.versions.get(expectedId);
      const chat = this.chat(expectedId);
      if (chat && !stale) {
        const next = {
          ...chat,
          title: result.chat_title || chat.title,
          pending_topic: result.suggestions?.[0] || result.suggestion || null,
          pending_topics: result.suggestions || [],
          pending_map_suggestion: this.snapshot.mapAccess ? result.map_suggestion || null : null,
        };
        if (JSON.stringify(next) !== JSON.stringify(chat)) this.upsert(next, false);
        this.emit({ analysisStatus: result.analysis_status });
        if (
          (this.snapshot.review === 'topic' && !next.pending_topic) ||
          (this.snapshot.review === 'note' && !next.pending_map_suggestion)
        )
          this.closeReview();
      }
      if (['queued', 'analysing'].includes(result.analysis_status) || stale)
        this.schedulePoll(attempt + 1);
    } catch (error) {
      if (
        this.current(owner) &&
        expectedId === this.snapshot.active &&
        !reader.signal.aborted &&
        !(error instanceof ApiError && [401, 403, 423, 404].includes(error.status))
      )
        this.schedulePoll(attempt + 1);
    }
  }
  async retryAnalysis() {
    const id = this.snapshot.active,
      owner = this.owner;
    if (!id || this.snapshot.retryPending || !this.current(owner) || !this.snapshot.enabled) return;
    this.emit({ retryPending: true, retryError: false });
    try {
      await api.retryAnalysis(this.session.api, id);
      if (this.current(owner) && id === this.snapshot.active) {
        this.emit({ analysisStatus: 'queued' });
        this.schedulePoll();
      }
    } catch {
      if (this.current(owner) && id === this.snapshot.active) this.emit({ retryError: true });
    } finally {
      if (this.current(owner)) this.emit({ retryPending: false });
    }
  }
  async openReview(kind: 'topic' | 'note') {
    const chat = this.chat(),
      owner = this.owner,
      navigation = this.navigation;
    if (!this.current(owner) || !this.snapshot.enabled) return;
    const hasSuggestion =
      kind === 'topic'
        ? chat?.pending_topic
        : this.snapshot.mapAccess && chat?.pending_map_suggestion;
    if (!hasSuggestion) return;
    if (this.snapshot.mapAccess && this.map && !this.map.getSnapshot().data) await this.map.load();
    if (
      this.current(owner) &&
      navigation === this.navigation &&
      chat?.chat_id === this.snapshot.active &&
      this.snapshot.enabled
    )
      this.emit({ review: kind, error: '' });
  }
  closeReview() {
    this.emit({ review: null });
  }
  async decideTopic(payload: TopicDecision) {
    const owner = this.owner;
    if (!this.current(owner) || !this.snapshot.enabled || this.snapshot.reviewPending) return false;
    const id = payload.chat_id;
    this.touch(id);
    this.emit({ reviewPending: true, error: '' });
    try {
      const result = await api.decideTopic(this.session.api, payload);
      if (!this.current(owner) || this.tombstones.has(id)) return false;
      if (result.profile.self_authorship_map)
        this.map?.acceptExternal(result.profile.self_authorship_map, result.commitVersion);
      const chat = this.chat(id);
      if (chat) {
        const remaining = (chat.pending_topics || []).filter(
          (topic) => topic.suggestion_id !== payload.suggestion_id,
        );
        this.upsert({ ...chat, pending_topic: null, pending_topics: remaining }, false);
      }
      if (this.snapshot.active === id) this.closeReview();
      await this.loadList();
      if (this.snapshot.active === id) void this.poll();
      return true;
    } catch (error) {
      if (this.current(owner) && this.snapshot.active === id) this.error(error);
      return false;
    } finally {
      if (this.current(owner)) this.emit({ reviewPending: false });
    }
  }
  async decideNote(payload: NoteDecision) {
    const owner = this.owner;
    if (!this.current(owner) || !this.snapshot.enabled || this.snapshot.reviewPending) return false;
    const id = payload.chat_id;
    this.touch(id);
    this.emit({ reviewPending: true, error: '' });
    try {
      const result = await api.decideNote(this.session.api, payload);
      if (!this.current(owner) || this.tombstones.has(id)) return false;
      this.map?.acceptExternal(result.map, result.commitVersion);
      const chat = this.chat(id);
      if (chat) this.upsert({ ...chat, pending_map_suggestion: null }, false);
      if (this.snapshot.active === id) this.closeReview();
      return true;
    } catch (error) {
      if (this.current(owner) && this.snapshot.active === id) this.error(error);
      return false;
    } finally {
      if (this.current(owner)) this.emit({ reviewPending: false });
    }
  }
  toggleMenu(id: string) {
    this.emit({ menu: this.snapshot.menu === id ? null : id });
  }
  closeMenu() {
    if (this.snapshot.menu) this.emit({ menu: null });
  }
  confirmDelete(id: string) {
    this.closeMenu();
    if (this.chat(id)) this.emit({ confirmation: id });
  }
  closeConfirmation() {
    this.emit({ confirmation: null });
  }
  async remove(id: string) {
    const owner = this.owner;
    if (!this.current(owner) || this.snapshot.deleting) return false;
    this.emit({ deleting: id, confirmation: null });
    try {
      await api.deleteConversation(this.session.api, id);
      if (!this.current(owner)) return false;
      this.tombstones.add(id);
      this.failed.delete(id);
      this.touch(id, false, true);
      if (this.request?.chatId === id) this.request.controller.abort();
      const chats = this.snapshot.chats.filter((chat) => chat.chat_id !== id);
      this.emit({ chats });
      if (this.snapshot.active === id) {
        if (chats[0]) await this.select(chats[0].chat_id);
        else this.newConversation();
      }
      return true;
    } catch (error) {
      if (this.current(owner)) this.error(error);
      return false;
    } finally {
      if (this.current(owner)) this.emit({ deleting: null });
    }
  }
  async react(created_at: string, reaction: Reaction, turnId?: number) {
    const id = this.snapshot.active,
      owner = this.owner,
      key = `${id}:${created_at}`;
    if (
      !id ||
      !this.snapshot.enabled ||
      !this.current(owner) ||
      this.snapshot.reactionPending.includes(key)
    )
      return;
    this.touch(id);
    this.emit({ reactionPending: [...this.snapshot.reactionPending, key] });
    try {
      const result = await api.react(this.session.api, id, created_at, reaction, turnId);
      if (!this.current(owner) || this.tombstones.has(id)) return;
      const chat = this.chat(id);
      if (chat) {
        let matched = false;
        this.upsert(
          {
            ...chat,
            messages: chat.messages.map((message) => {
              if (
                !matched &&
                message.role === 'assistant' &&
                (turnId ? message.turn_id === turnId : message.created_at === created_at)
              ) {
                matched = true;
                return { ...message, reaction: result };
              }
              return message;
            }),
          },
          false,
        );
      }
    } catch (error) {
      if (this.current(owner) && this.snapshot.active === id) this.error(error);
    } finally {
      if (this.current(owner))
        this.emit({
          reactionPending: this.snapshot.reactionPending.filter((value) => value !== key),
        });
    }
  }
  private cancel() {
    this.navigation++;
    this.listRequest++;
    this.reader?.abort();
    this.historyReader?.abort();
    this.listReader?.abort();
    this.stopPolling();
    this.request?.controller.abort();
    this.request?.player?.cancel();
  }
  stop() {
    this.alive = false;
    this.cancel();
    this.request = null;
  }
}

import { ApiError } from '../../services/apiClient';
import type { SessionController } from '../../services/sessionController';
import { mapRevision, subscribeMapWrites, waitForMapWrites } from '../../services/mapResource';
import { mapNodes, OVERALL_ID } from './mapLayout';
import type { MapFilter } from './mapLayout';
import type { MapData, EntryPayload, TopicPayload, PracticeStatus } from '../../types/map';
import { topicCategoryOf } from '../../types/map';
import * as api from './mapApi';

export type MapPopup =
  | { key: number; kind: 'topic'; id?: string }
  | { key: number; kind: 'entry' | 'task'; nodeId: string; entryId?: string };
export interface MapSnapshot {
  data: MapData | null;
  enabled: boolean;
  denied: boolean;
  loading: boolean;
  loadError: string;
  error: string;
  errorStatus: number | null;
  selected: string | null;
  detailOpen: boolean;
  filter: MapFilter;
  popup: MapPopup | null;
  confirmation: string | null;
  pending: string[];
  menu: string | null;
}
export class MapController {
  private owner: string | null = null;
  private capability: unknown;
  private alive = true;
  private active = false;
  private request = 0;
  private selectionRevision = 0;
  private commitVersion = -1;
  private read: AbortController | null = null;
  private popupKey = 0;
  private sourceChatId: string | null = null;
  private confirmOperation: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private snapshot: MapSnapshot = {
    data: null,
    enabled: false,
    denied: false,
    loading: false,
    loadError: '',
    error: '',
    errorStatus: null,
    selected: null,
    detailOpen: false,
    filter: 'all',
    popup: null,
    confirmation: null,
    pending: [],
    menu: null,
  };
  constructor(private readonly session: SessionController) {}
  getSnapshot = () => this.snapshot;
  isOwnedBy = (token: string | null) => token !== null && token === this.owner;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };
  private emit(change: Partial<MapSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((notify) => notify());
  }
  private current(owner: string | null) {
    return (
      this.alive && owner !== null && owner === this.owner && owner === this.session.getToken()
    );
  }
  configure(owner: string | null, allowed: boolean, capability: unknown) {
    this.alive = true;
    if (!this.unsubscribe)
      this.unsubscribe = subscribeMapWrites(this.session.api, () => {
        this.cancelRead();
        // Our writes already return the whole authoritative Map. External Journal
        // review needs a read; never fetch an intermediate full-profile snapshot.
        if (this.active && this.snapshot.enabled && !this.snapshot.pending.length) void this.load();
        else if (this.snapshot.loading) this.emit({ loading: false });
      });
    if (owner !== this.owner) {
      this.cancelRead();
      this.owner = owner;
      this.commitVersion = -1;
      this.selectionRevision++;
      this.sourceChatId = null;
      this.confirmOperation = null;
      this.emit({
        data: null,
        selected: null,
        detailOpen: false,
        filter: 'all',
        popup: null,
        confirmation: null,
        pending: [],
        menu: null,
        denied: false,
        error: '',
        errorStatus: null,
        loadError: '',
        loading: false,
      });
    }
    const denied = capability === this.capability && this.snapshot.denied;
    this.capability = capability;
    this.emit({ enabled: Boolean(owner && allowed && !denied), denied });
    if (!this.snapshot.enabled) {
      this.cancelRead();
      this.emit({ loading: false });
    }
  }
  private cancelRead() {
    this.request++;
    this.read?.abort();
    this.read = null;
  }
  visit() {
    this.active = true;
    this.selectionRevision++;
    this.emit({ selected: null, detailOpen: false });
    return this.load();
  }
  resume(loadIfMissing = true) {
    this.active = true;
    if (loadIfMissing && !this.snapshot.data && this.snapshot.enabled) return this.load();
  }
  leave() {
    this.active = false;
    this.cancelRead();
    this.confirmOperation = null;
    this.emit({ loading: false, popup: null, confirmation: null, menu: null });
  }
  async load(clearMutationError = false) {
    if (!this.snapshot.enabled) return false;
    this.cancelRead();
    const request = this.request;
    const owner = this.owner;
    this.emit({ loading: true, loadError: '' });
    try {
      const revision = await waitForMapWrites(this.session.api);
      if (!this.current(owner) || request !== this.request || !this.snapshot.enabled) return false;
      const read = new AbortController();
      this.read = read;
      const data = await api.loadMap(this.session.api, read.signal);
      if (
        !this.current(owner) ||
        request !== this.request ||
        read.signal.aborted ||
        revision !== mapRevision(this.session.api)
      )
        return false;
      this.apply(data, revision);
      this.emit({ loadError: '', errorStatus: null, ...(clearMutationError ? { error: '' } : {}) });
      return true;
    } catch (error) {
      if (this.current(owner) && request === this.request) {
        this.failure(error, false);
        this.emit({ loadError: error instanceof Error ? error.message : 'Could not load My Map.' });
      }
      return false;
    } finally {
      if (this.current(owner) && request === this.request) this.emit({ loading: false });
    }
  }
  private apply(data: MapData, version: number) {
    if (version < this.commitVersion) return false;
    this.commitVersion = version;
    const selected = mapNodes(data).find((node) => node.id === this.snapshot.selected);
    this.emit({
      data,
      selected: selected?.id ?? null,
      detailOpen: Boolean(selected && this.snapshot.detailOpen),
      filter:
        selected &&
        this.snapshot.detailOpen &&
        this.snapshot.filter !== 'all' &&
        topicCategoryOf(selected) !== this.snapshot.filter
          ? 'all'
          : this.snapshot.filter,
    });
    return true;
  }
  private failure(error: unknown, mutation = true) {
    const status = error instanceof ApiError ? error.status : 0;
    this.emit({
      ...(mutation
        ? { error: error instanceof Error ? error.message : 'Could not update My Map.' }
        : {}),
      errorStatus: status,
      ...(status === 402 ? { denied: true, enabled: false, popup: null, confirmation: null } : {}),
    });
  }
  select(id: string) {
    if (!this.snapshot.data || !mapNodes(this.snapshot.data).some((node) => node.id === id)) return;
    this.selectionRevision++;
    const node = mapNodes(this.snapshot.data).find((node) => node.id === id)!;
    this.emit({
      selected: id,
      detailOpen: true,
      filter:
        this.snapshot.filter !== 'all' && topicCategoryOf(node) !== this.snapshot.filter
          ? 'all'
          : this.snapshot.filter,
    });
  }
  closeDetails() {
    this.selectionRevision++;
    this.emit({ detailOpen: false });
  }
  setChatSource(id: string | null) {
    if (this.current(this.owner)) this.sourceChatId = id;
  }
  acceptExternal(data: MapData, version: number) {
    if (this.current(this.owner) && this.snapshot.enabled) return this.apply(data, version);
    return false;
  }
  toggleMenu(id: string) {
    this.emit({ menu: this.snapshot.menu === id ? null : id });
  }
  closeMenu() {
    if (this.snapshot.menu) this.emit({ menu: null });
  }
  filter(filter: MapFilter) {
    this.selectionRevision++;
    this.emit({ filter, selected: null, detailOpen: false });
  }
  openTopic(id?: string) {
    if (this.canWrite() && this.snapshot.data && !this.snapshot.pending.length)
      this.emit({ popup: { key: ++this.popupKey, kind: 'topic', id }, error: '' });
  }
  openEntry(nodeId: string, task = false, entryId?: string) {
    if (this.canWrite() && !this.snapshot.pending.length)
      this.emit({
        popup: { key: ++this.popupKey, kind: task ? 'task' : 'entry', nodeId, entryId },
        error: '',
      });
  }
  closePopup() {
    if (!this.snapshot.pending.length && !this.snapshot.confirmation) this.emit({ popup: null });
  }
  confirm(message: string, operation: () => void) {
    if (this.canWrite() && !this.snapshot.confirmation) {
      this.confirmOperation = operation;
      this.emit({ confirmation: message });
    }
  }
  cancelConfirmation() {
    this.confirmOperation = null;
    this.emit({ confirmation: null });
  }
  acceptConfirmation() {
    const operation = this.confirmOperation;
    this.cancelConfirmation();
    operation?.();
  }
  private canWrite() {
    return this.snapshot.enabled && this.snapshot.errorStatus !== 403;
  }
  private async mutate(
    key: string,
    operation: () => Promise<api.MapMutation>,
    select?: (result: api.MapMutation) => string | null,
  ) {
    if (!this.current(this.owner) || !this.canWrite() || this.snapshot.pending.includes(key))
      return false;
    const owner = this.owner;
    const selection = this.selectionRevision;
    this.emit({ pending: [...this.snapshot.pending, key], error: '' });
    try {
      const result = await operation();
      if (!this.current(owner)) return false;
      const applied = this.apply(result.map, result.commitVersion);
      if (applied) this.emit({ error: '', errorStatus: null });
      if (applied && select && selection === this.selectionRevision) {
        const id = select(result);
        this.emit({ selected: id, detailOpen: Boolean(id), filter: 'all' });
      }
      return true;
    } catch (error) {
      if (this.current(owner)) this.failure(error);
      return false;
    } finally {
      if (this.current(owner)) {
        this.emit({ pending: this.snapshot.pending.filter((value) => value !== key) });
        if (
          !this.snapshot.pending.length &&
          this.active &&
          this.snapshot.enabled &&
          this.commitVersion < mapRevision(this.session.api)
        )
          void this.load();
      }
    }
  }
  saveTopic(payload: TopicPayload, id?: string) {
    return this.mutate(
      id ? `topic:${id}` : 'new-topic',
      () =>
        id
          ? api.updateTopic(this.session.api, id, payload)
          : api.createTopic(this.session.api, { ...payload, chat_id: this.sourceChatId }),
      (result) => result.topic!.id,
    );
  }
  merge(id: string, target: string) {
    return this.mutate(
      `topic:${id}`,
      () => api.mergeTopic(this.session.api, id, target),
      (result) => result.topic!.id,
    );
  }
  deleteTopic(id: string) {
    return this.mutate(
      `topic:${id}`,
      () => api.deleteTopic(this.session.api, id),
      () => null,
    );
  }
  saveEntry(payload: EntryPayload, nodeId: string, id?: string) {
    return this.mutate(
      id ? `entry:${id}` : 'new-entry',
      () =>
        id
          ? api.updateEntry(this.session.api, id, payload)
          : api.createEntry(this.session.api, { ...payload, source_chat_id: this.sourceChatId }),
      id
        ? undefined
        : () => payload.topic_space_id || (nodeId === OVERALL_ID ? OVERALL_ID : nodeId),
    );
  }
  deleteEntry(id: string) {
    return this.mutate(`entry:${id}`, () => api.deleteEntry(this.session.api, id));
  }
  practice(id: string, status: PracticeStatus, reflection: string | null = null) {
    return this.mutate(`entry:${id}`, () =>
      api.updatePractice(this.session.api, id, status, reflection),
    );
  }
  disconnect(nodeId: string, relationship: string, targetId: string) {
    // Reuse the authoritative topic's relation list, not a second edge store.
    const node = this.snapshot.data?.topic_spaces.find((topic) => topic.id === nodeId);
    if (!node) return Promise.resolve(false);
    return this.mutate(`topic:${relationship === 'Contains' ? targetId : nodeId}`, () =>
      api.updateTopic(
        this.session.api,
        relationship === 'Contains' ? targetId : nodeId,
        relationship === 'Related'
          ? { related_topic_ids: (node.related_topic_ids || []).filter((id) => id !== targetId) }
          : { parent_topic_id: null },
      ),
    );
  }
  stop() {
    this.alive = false;
    this.active = false;
    this.cancelRead();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

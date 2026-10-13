import { ApiError } from '../../services/apiClient';
import type { SessionController } from '../../services/sessionController';
import { historyItem, localDateKey, validDateKey } from './dates';
import * as api from './journalApi';
import type {
  JournalDraft,
  JournalEntry,
  JournalHistoryItem,
  JournalSnapshot,
  SuggestionDecision,
} from './types';

const fresh = (): JournalDraft => ({
  entry: null,
  text: '',
  baseline: '',
  loading: false,
  loadError: '',
  status: 'saved',
  message: 'New page',
  saving: false,
  revision: 0,
  inflightText: null,
  editRevision: 0,
  editedAt: 0,
  errorStatus: null,
});
const message = (error: unknown) => (error instanceof Error ? error.message : 'Could not save');
export class JournalController {
  private owner: string | null = null;
  private enabled = false;
  private denied = false;
  private capabilitySource: unknown;
  private active = true;
  private selected = localDateKey();
  private drafts = new Map<string, JournalDraft>();
  private queues = new Map<string, Promise<unknown>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private reads = new Map<string, AbortController>();
  private selection = 0;
  private historyRequest = 0;
  private topicsRequest = 0;
  private topicsVersion = 0;
  private historyVersion = 0;
  private historyChanges: { version: number; date: string; item: JournalHistoryItem | null }[] = [];
  private visiting: Promise<void> | null = null;
  private visited = false;
  private listeners = new Set<() => void>();
  private snapshot: JournalSnapshot = {
    selected: this.selected,
    draft: fresh(),
    dirty: false,
    enabled: false,
    denied: false,
    history: [],
    historyLoading: false,
    historyError: '',
    topics: [],
    topicsError: '',
    analysing: false,
    deciding: [],
  };
  constructor(private readonly session: SessionController) {}
  getSnapshot = () => this.snapshot;
  isOwnedBy = (token: string | null) => token !== null && token === this.owner;
  hasUnsaved = () => [...this.drafts.values()].some((draft) => this.isDirty(draft));
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  private draft(date = this.selected) {
    let value = this.drafts.get(date);
    if (!value) {
      value = fresh();
      this.drafts.set(date, value);
    }
    return value;
  }
  private emit(change: Partial<JournalSnapshot> = {}) {
    const draft = this.draft();
    this.snapshot = {
      ...this.snapshot,
      ...change,
      selected: this.selected,
      draft: { ...draft },
      dirty: this.isDirty(draft),
      enabled: this.enabled,
      denied: this.denied,
    };
    this.listeners.forEach((callback) => callback());
  }
  private isDirty(draft: JournalDraft) {
    return draft.text !== draft.baseline || (draft.saving && draft.text !== draft.inflightText);
  }
  private current(owner: string | null) {
    return this.active && owner === this.owner && owner === this.session.getToken();
  }
  configure(token: string | null, enabled: boolean, capabilitySource: unknown) {
    this.active = true;
    if (token !== this.owner) {
      this.cancel();
      this.owner = token;
      this.selected = localDateKey();
      this.drafts.clear();
      this.queues.clear();
      this.historyVersion = 0;
      this.historyChanges = [];
      this.denied = false;
      this.visiting = null;
      this.visited = false;
      this.snapshot = {
        ...this.snapshot,
        history: [],
        historyError: '',
        historyLoading: false,
        topics: [],
        topicsError: '',
        analysing: false,
        deciding: [],
      };
    }
    if (capabilitySource !== this.capabilitySource) this.denied = false;
    this.capabilitySource = capabilitySource;
    const wasEnabled = this.enabled;
    this.enabled = Boolean(token && enabled && !this.denied);
    if (!this.enabled) {
      this.timers.forEach(clearTimeout);
      this.timers.clear();
    }
    this.emit();
    if (!wasEnabled && this.enabled)
      for (const [date, draft] of this.drafts)
        if (draft.entry && draft.text !== draft.baseline) this.schedule(date);
  }
  private failure(error: unknown, date?: string) {
    if (error instanceof ApiError && error.status === 402) {
      this.denied = true;
      this.enabled = false;
      this.timers.forEach(clearTimeout);
      this.timers.clear();
    }
    if (date) {
      const draft = this.draft(date);
      draft.status = 'error';
      draft.message = message(error);
      draft.errorStatus = error instanceof ApiError ? error.status : 0;
    }
    this.emit();
  }
  async visit() {
    if (!this.enabled) return;
    if (this.visiting) return this.visiting;
    if (!this.visited) {
      this.visited = true;
      this.selected = localDateKey();
      this.emit();
    }
    const request = Promise.all([this.loadHistory(), this.open(this.selected)]).then(() => {});
    this.visiting = request;
    await request;
    if (this.visiting === request) this.visiting = null;
  }
  async loadHistory() {
    if (!this.enabled) return;
    const owner = this.owner;
    const request = ++this.historyRequest;
    const version = this.historyVersion;
    this.emit({ historyLoading: true, historyError: '' });
    try {
      let result = await api.loadJournalHistory(this.session.api);
      if (!this.current(owner) || request !== this.historyRequest) return;
      for (const update of this.historyChanges.filter((update) => update.version > version)) {
        result = result.filter((item) => item.entry_date !== update.date);
        if (update.item) result.push(update.item);
      }
      this.emit({
        history: result.sort((a, b) => b.entry_date.localeCompare(a.entry_date)),
        historyError: '',
      });
    } catch (error) {
      if (this.current(owner) && request === this.historyRequest) {
        this.failure(error);
        this.emit({ historyError: message(error) });
      }
    } finally {
      if (this.current(owner) && request === this.historyRequest)
        this.emit({ historyLoading: false });
    }
  }
  async loadTopics() {
    const owner = this.owner;
    if (!this.enabled) return;
    const request = ++this.topicsRequest;
    const version = this.topicsVersion;
    try {
      const topics = await api.loadJournalTopics(this.session.api);
      if (this.current(owner) && request === this.topicsRequest && version === this.topicsVersion)
        this.emit({ topics, topicsError: '' });
    } catch (error) {
      if (this.current(owner) && request === this.topicsRequest && version === this.topicsVersion)
        this.emit({ topicsError: message(error) });
    }
  }
  async open(date: string): Promise<boolean> {
    if (!this.enabled || !validDateKey(date)) return false;
    this.visited = true;
    const owner = this.owner;
    const selection = ++this.selection;
    if (!(await this.flush())) return false;
    if (!this.current(owner) || selection !== this.selection || !this.enabled) return false;
    this.reads.forEach((read) => read.abort());
    this.reads.clear();
    this.selected = date;
    const draft = this.draft(date);
    // A retained draft must be committed before any read can replace it.
    if (draft.text !== draft.baseline && !(await this.flush(date))) {
      this.emit();
      return false;
    }
    if (!this.current(owner) || selection !== this.selection) return false;
    const read = new AbortController();
    this.reads.set(date, read);
    const revision = draft.revision;
    draft.loading = true;
    draft.loadError = '';
    draft.message = 'Loading...';
    draft.status = 'saving';
    this.emit();
    try {
      const result = await api.loadJournalEntry(this.session.api, date, read.signal);
      if (!this.current(owner) || selection !== this.selection || read.signal.aborted) return false;
      if (revision !== draft.revision) return true; // A completed mutation is newer than this read.
      draft.entry = result;
      draft.text = result.content;
      draft.baseline = result.content;
      draft.errorStatus = null;
      draft.message = result.updated_at ? 'Saved' : 'New page';
      draft.status = 'saved';
      if (result.suggestions.length) void this.loadTopics();
      return true;
    } catch (error) {
      if (this.current(owner) && selection === this.selection && !read.signal.aborted) {
        draft.loadError = message(error);
        this.failure(error, date);
      }
      return false;
    } finally {
      if (this.current(owner) && selection === this.selection) {
        draft.loading = false;
        this.emit();
      }
      if (this.reads.get(date) === read) this.reads.delete(date);
    }
  }
  edit(text: string) {
    const draft = this.draft();
    if (!this.enabled || draft.loading || !draft.entry || text.length > 100000) return;
    draft.text = text;
    draft.editRevision++;
    draft.editedAt = Date.now();
    const dirty = this.isDirty(draft);
    draft.errorStatus = null;
    draft.status = dirty ? 'saving' : 'saved';
    if (dirty) {
      draft.message = 'Unsaved';
    } else {
      draft.message = draft.entry.updated_at ? 'Saved' : 'New page';
    }
    this.clearTimer(this.selected);
    if (dirty) this.schedule(this.selected);
    this.emit();
  }
  private clearTimer(date: string) {
    const timer = this.timers.get(date);
    if (timer) clearTimeout(timer);
    this.timers.delete(date);
  }
  private schedule(date: string, delay = 900) {
    const revision = this.draft(date).editRevision;
    this.clearTimer(date);
    this.timers.set(
      date,
      setTimeout(() => {
        this.timers.delete(date);
        void this.save(date, false, revision);
      }, delay),
    );
  }
  private enqueue<T>(date: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(date) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.queues.set(date, next);
    void next.then(
      () => {
        if (this.queues.get(date) === next) this.queues.delete(date);
      },
      () => {
        if (this.queues.get(date) === next) this.queues.delete(date);
      },
    );
    return next;
  }
  private updateHistory(entry: JournalEntry) {
    const item = historyItem(entry);
    const value = item.word_count || item.suggestion_count ? item : null;
    this.historyChanges.push({
      version: ++this.historyVersion,
      date: entry.entry_date,
      item: value,
    });
    const history = this.snapshot.history.filter((item) => item.entry_date !== entry.entry_date);
    if (value) history.push(value);
    this.emit({ history: history.sort((a, b) => b.entry_date.localeCompare(a.entry_date)) });
  }
  save(date = this.selected, keepalive = false, editRevision?: number): Promise<boolean> {
    const owner = this.owner;
    return this.enqueue(date, async () => {
      if (!this.current(owner) || !this.enabled) return false;
      // A newer debounce owns the queued autosave.
      if (editRevision !== undefined && editRevision !== this.draft(date).editRevision) return true;
      const draft = this.draft(date);
      if (draft.text === draft.baseline) return true;
      const text = draft.text;
      draft.saving = true;
      draft.inflightText = text;
      draft.status = 'saving';
      draft.message = 'Saving...';
      this.emit();
      let succeeded = false;
      try {
        const result = await api.saveJournalEntry(this.session.api, date, text, keepalive);
        if (!this.current(owner)) return false;
        draft.entry = result;
        draft.baseline = result.content;
        draft.revision++;
        draft.errorStatus = null;
        if (draft.text === text) draft.text = result.content; // Never replace newer local edits.
        draft.status = draft.text === draft.baseline ? 'saved' : 'saving';
        draft.message = draft.text === draft.baseline ? 'Saved' : 'Unsaved';
        succeeded = true;
        this.updateHistory(result);
        return true;
      } catch (error) {
        if (this.current(owner)) this.failure(error, date);
        return false;
      } finally {
        if (this.current(owner)) {
          draft.saving = false;
          draft.inflightText = null;
          if (succeeded && draft.text !== draft.baseline && !this.timers.has(date))
            this.schedule(date, Math.max(0, draft.editedAt + 900 - Date.now()));
          this.emit();
        }
      }
    });
  }
  async flush(date = this.selected, keepalive = false): Promise<boolean> {
    this.clearTimer(date);
    const owner = this.owner;
    while (this.current(owner) && this.enabled && this.isDirty(this.draft(date))) {
      if (!(await this.save(date, keepalive))) return false;
    }
    return this.current(owner);
  }
  flushAll(keepalive = false) {
    return Promise.all(
      [...this.drafts]
        .filter(([, draft]) => this.isDirty(draft))
        .map(([date]) => this.flush(date, keepalive)),
    );
  }
  async analyse() {
    const date = this.selected;
    const owner = this.owner;
    if (!this.enabled || this.snapshot.analysing) return;
    this.emit({ analysing: true });
    try {
      if (!(await this.flush(date)) || date !== this.selected) return;
      await this.enqueue(date, async () => {
        if (!this.current(owner) || !this.enabled) return;
        const draft = this.draft(date);
        draft.status = 'saving';
        draft.message = 'Analysing...';
        this.emit();
        const result = await api.analyseJournalEntry(this.session.api, date);
        if (!this.current(owner)) return;
        draft.entry = result;
        draft.revision++;
        draft.status = draft.text === draft.baseline ? 'saved' : 'saving';
        draft.message = draft.text === draft.baseline ? 'Analysis ready' : 'Unsaved';
        this.updateHistory(result);
        await this.loadTopics();
      });
    } catch (error) {
      if (this.current(owner)) this.failure(error, date);
    } finally {
      if (this.current(owner)) this.emit({ analysing: false });
    }
  }
  async decide(id: string, payload: SuggestionDecision) {
    const date = this.selected;
    const owner = this.owner;
    if (!this.enabled || this.snapshot.deciding.includes(id)) return;
    this.emit({ deciding: [...this.snapshot.deciding, id] });
    try {
      await this.enqueue(date, async () => {
        if (!this.current(owner) || !this.enabled) return;
        const result = await api.decideJournalSuggestion(this.session.api, date, id, payload);
        if (!this.current(owner)) return;
        const draft = this.draft(date);
        if (draft.entry) {
          draft.entry = {
            ...draft.entry,
            suggestions: draft.entry.suggestions.map((item) =>
              item.id === id ? result.suggestion : item,
            ),
          };
          draft.revision++;
        }
        this.topicsVersion++;
        this.emit({ topics: result.map.topic_spaces, topicsError: '' });
      });
    } catch (error) {
      if (this.current(owner)) this.failure(error, date);
    } finally {
      if (this.current(owner))
        this.emit({ deciding: this.snapshot.deciding.filter((value) => value !== id) });
    }
  }
  private cancel() {
    this.selection++;
    this.historyRequest++;
    this.topicsRequest++;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.reads.forEach((read) => read.abort());
    this.reads.clear();
  }
  stop() {
    this.active = false;
    this.cancel();
  }
}

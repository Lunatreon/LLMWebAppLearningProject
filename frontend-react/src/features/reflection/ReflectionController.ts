import type { SessionController } from '../../services/sessionController';
import type { MapController } from '../map/MapController';
import { practiceSource } from './types';
import type { ReflectionSnapshot } from './types';
import { completePractice } from './reflectionApi';
const empty = (): ReflectionSnapshot => ({
  id: null,
  answer: '',
  enabled: false,
  loading: false,
  verified: false,
  pending: false,
  error: '',
  loadError: '',
  initiallyCompleted: false,
  completedWithNewEdits: false,
});
export class ReflectionController {
  private owner: string | null = null;
  private alive = true;
  private active = false;
  private sourceRequest = 0;
  private submission = 0;
  private editRevision = 0;
  private submittedRevision: number | null = null;
  private listeners = new Set<() => void>();
  private snapshot = empty();
  constructor(
    private readonly session: SessionController,
    private readonly map: MapController,
  ) {}
  getSnapshot = () => this.snapshot;
  isOwnedBy = (token: string | null) => token !== null && token === this.owner;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };
  private emit(change: Partial<ReflectionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((notify) => notify());
  }
  private current(owner: string | null) {
    return (
      this.alive && owner !== null && owner === this.owner && owner === this.session.getToken()
    );
  }
  configure(owner: string | null, enabled: boolean) {
    this.alive = true;
    if (owner !== this.owner) {
      this.owner = owner;
      this.sourceRequest++;
      this.submission++;
      this.editRevision = 0;
      this.submittedRevision = null;
      this.snapshot = empty();
    }
    if (!enabled) {
      this.sourceRequest++;
      this.emit({ loading: false });
    }
    this.emit({ enabled: Boolean(owner && enabled) });
  }
  async open(id: string | null, reset = false) {
    this.active = true;
    if (id !== this.snapshot.id || reset) {
      this.submission++;
      this.editRevision = 0;
      this.submittedRevision = null;
      this.emit({ ...empty(), id, enabled: this.snapshot.enabled });
    }
    if (!id || !this.snapshot.enabled) return;
    const owner = this.owner,
      request = ++this.sourceRequest;
    const recoveringGate = [402, 403, 423].includes(this.map.getSnapshot().errorStatus || 0);
    this.emit({ loading: true, loadError: '' });
    let loaded = await this.map.load();
    if (
      !loaded &&
      this.current(owner) &&
      this.active &&
      request === this.sourceRequest &&
      this.snapshot.enabled &&
      this.map.getSnapshot().loading
    )
      loaded = await this.map.load();
    if (
      !this.current(owner) ||
      !this.active ||
      request !== this.sourceRequest ||
      !this.snapshot.enabled
    )
      return;
    const state = this.map.getSnapshot(),
      practice = practiceSource(state.data, id);
    if (!loaded || state.loadError)
      this.emit({
        loadError: state.loadError || 'Could not load this practice. Please try again.',
        verified: false,
      });
    else if (!practice) this.emit({ loadError: 'Practice not found.', verified: false });
    else {
      const initiallyCompleted =
        !this.snapshot.verified && !this.snapshot.pending && practice.status === 'completed';
      this.emit({
        verified: true,
        loadError: '',
        ...(recoveringGate ? { error: '' } : {}),
        ...(initiallyCompleted
          ? { initiallyCompleted: true, answer: this.snapshot.answer || practice.reflection || '' }
          : {}),
      });
    }
    this.emit({ loading: false });
  }
  edit(answer: string) {
    if (!this.snapshot.enabled || !this.snapshot.verified || this.snapshot.initiallyCompleted)
      return;
    this.editRevision++;
    this.emit({
      answer,
      error: '',
      completedWithNewEdits:
        this.submittedRevision !== null && this.editRevision !== this.submittedRevision,
    });
  }
  synchronize() {
    if (
      this.snapshot.verified &&
      !this.snapshot.loading &&
      this.map.getSnapshot().data &&
      !practiceSource(this.map.getSnapshot().data, this.snapshot.id)
    ) {
      this.emit({ verified: false, loadError: 'Practice not found.' });
      return;
    }
    if (
      this.submittedRevision !== null &&
      this.editRevision !== this.submittedRevision &&
      !this.snapshot.initiallyCompleted &&
      practiceSource(this.map.getSnapshot().data, this.snapshot.id)?.status === 'completed' &&
      !this.snapshot.completedWithNewEdits
    )
      this.emit({ completedWithNewEdits: true });
  }
  leave() {
    this.active = false;
    this.sourceRequest++;
    this.submission++;
    this.emit({ loading: false, pending: false });
  }
  close() {
    this.leave();
    this.editRevision = 0;
    this.submittedRevision = null;
    this.emit({ ...empty(), enabled: this.snapshot.enabled });
  }
  async submit(): Promise<boolean> {
    const state = this.snapshot,
      practice = practiceSource(this.map.getSnapshot().data, state.id);
    if (
      !this.current(this.owner) ||
      !this.active ||
      !state.enabled ||
      !state.id ||
      !state.verified ||
      state.loading ||
      state.pending ||
      state.initiallyCompleted ||
      !practice ||
      (practice.status === 'completed' && !state.completedWithNewEdits) ||
      this.map.getSnapshot().pending.includes(`entry:${state.id}`)
    )
      return false;
    const id = state.id,
      owner = this.owner,
      submission = ++this.submission,
      revision = this.editRevision;
    this.submittedRevision = revision;
    this.emit({ pending: true, error: '', completedWithNewEdits: false });
    const success = await completePractice(this.map, id, state.answer);
    if (
      !this.current(owner) ||
      !this.active ||
      submission !== this.submission ||
      id !== this.snapshot.id
    )
      return false;
    const updated = practiceSource(this.map.getSnapshot().data, id);
    const newerEdits = revision !== this.editRevision;
    this.emit({
      pending: false,
      error: success
        ? ''
        : this.map.getSnapshot().error || 'Could not complete this practice. Please try again.',
      completedWithNewEdits: newerEdits,
    });
    // A late completion may update Map, but must not close over newer answers,
    // a new source, navigation or a same-owner access gate.
    return success && updated?.status === 'completed' && !newerEdits && this.snapshot.enabled;
  }
  stop() {
    this.alive = false;
    this.active = false;
    this.sourceRequest++;
    this.submission++;
  }
}

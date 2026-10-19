import { ApiClient, ApiError, sessionEndedMessage } from './apiClient';

// Queue/revision only: authoritative Map data belongs to MapContext. Chat
// review and Map mutations both write the same backend profile JSON.
type Resource = { tail: Promise<void>; revision: number; listeners: Set<() => void> };
const resources = new WeakMap<ApiClient, Resource>();
function resource(api: ApiClient) {
  let state = resources.get(api);
  if (!state) {
    state = { tail: Promise.resolve(), revision: 0, listeners: new Set() };
    resources.set(api, state);
  }
  return state;
}
export const mapRevision = (api: ApiClient) => resource(api).revision;
export function subscribeMapWrites(api: ApiClient, notify: () => void) {
  const state = resource(api);
  state.listeners.add(notify);
  return () => {
    state.listeners.delete(notify);
  };
}
export async function waitForMapWrites(api: ApiClient) {
  const state = resource(api);
  let tail: Promise<void>;
  do {
    tail = state.tail;
    await tail;
  } while (tail !== state.tail);
  return state.revision;
}
export function queueMapWrite<T>(api: ApiClient, operation: () => Promise<T>) {
  const state = resource(api);
  const token = api.getSessionToken();
  const changed = () => {
    state.revision++;
    state.listeners.forEach((notify) => notify());
  };
  const work = state.tail.then(async () => {
    if (!token || token !== api.getSessionToken()) throw new ApiError(sessionEndedMessage, 401);
    changed();
    try {
      const value = await operation();
      return { value, commitVersion: state.revision + 1 };
    } finally {
      changed();
    }
  });
  state.tail = work.then(
    () => {},
    () => {},
  );
  return work;
}

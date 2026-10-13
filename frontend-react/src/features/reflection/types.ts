import type { MapData, MapEntry } from '../../types/map';
export const reflectionPrompt =
  'Your reflection can include what helped, what got in the way, or what you would change.';
export function practiceSource(map: MapData | null, id: string | null): MapEntry | null {
  if (!map || !id) return null;
  return (
    [map.unassigned_entries, ...map.topic_spaces.map((topic) => topic.entries || [])]
      .flat()
      .find((entry) => entry.id === id && entry.category === 'practice') || null
  );
}
export function reflectionPracticeId(state: unknown): string | null {
  const id =
    state && typeof state === 'object' ? (state as { practiceId?: unknown }).practiceId : null;
  return typeof id === 'string' && id.trim() ? id : null;
}
export interface ReflectionSnapshot {
  id: string | null;
  answer: string;
  enabled: boolean;
  loading: boolean;
  verified: boolean;
  pending: boolean;
  error: string;
  loadError: string;
  initiallyCompleted: boolean;
  completedWithNewEdits: boolean;
}

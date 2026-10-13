import type { MapController } from '../map/MapController';
// Reflection is a field on the Practice, saved atomically with completion.
// Reuse the Map operation/DTO/queue rather than introducing another endpoint.
export function completePractice(map: MapController, id: string, answer: string) {
  return map.practice(id, 'completed', answer.trim() || null);
}

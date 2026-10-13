import type { SubscriptionResponse } from '../types/api';
export function hasMapAccess(subscription: SubscriptionResponse) {
  return Boolean(subscription.my_map_access);
}
export function hasJournalAccess(subscription: SubscriptionResponse) {
  return Boolean(subscription.journal_access ?? subscription.my_map_access);
}

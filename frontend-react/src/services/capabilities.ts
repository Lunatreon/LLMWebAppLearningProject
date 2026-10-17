import type { SubscriptionResponse } from '../types/api';
export function hasMapAccess(subscription: SubscriptionResponse) {
  return Boolean(subscription.my_map_access);
}

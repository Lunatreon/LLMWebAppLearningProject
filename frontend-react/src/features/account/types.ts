import type { AccountResponse } from '../../types/api';
export type { AccountResponse } from '../../types/api';

export interface ProfileValues {
  displayName: string;
  username: string;
  email: string;
  avatarUrl: string;
  bio: string;
}
export interface ProfileUpdate {
  display_name: string | null;
  username: string;
  email: string;
  avatar_url: string | null;
  bio: string | null;
}

export function profileValues(account: AccountResponse): ProfileValues {
  return {
    displayName: account.display_name || '',
    username: account.username || '',
    email: account.email || '',
    avatarUrl: account.avatar_url || '',
    bio: account.bio || '',
  };
}
export function profilePayload(values: ProfileValues): ProfileUpdate {
  return {
    display_name: values.displayName.trim() || null,
    username: values.username.trim(),
    email: values.email.trim(),
    avatar_url: values.avatarUrl.trim() || null,
    bio: values.bio.trim() || null,
  };
}
export function sameProfile(first: ProfileValues, second: ProfileValues) {
  return (Object.keys(first) as (keyof ProfileValues)[]).every((key) => first[key] === second[key]);
}
export function profileLengthsValid(values: ProfileValues) {
  return (
    values.username.length >= 3 &&
    values.username.length <= 80 &&
    values.displayName.length <= 120 &&
    values.avatarUrl.length <= 500 &&
    values.bio.length <= 500
  );
}

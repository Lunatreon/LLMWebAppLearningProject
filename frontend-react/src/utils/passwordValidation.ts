export const minimumPasswordLength = 8;
// HTML minimum is shared. Backend remains authoritative for the 128-char maximum;
// the reference registration/reset inputs do not impose maxlength or a pattern.
export function hasMinimumPasswordLength(password: string) {
  return password.length >= minimumPasswordLength;
}

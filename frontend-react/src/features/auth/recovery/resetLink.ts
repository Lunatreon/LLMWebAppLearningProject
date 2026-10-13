export const resetTokenParameter = 'reset_password_token';
export const resetSuccessMessage = 'Your password has been reset. You can now log in.';
export function recoverySearch(search: string) {
  const input = new URLSearchParams(search);
  const output = new URLSearchParams();
  // These public settings are all recovery navigation needs. Never carry tokens,
  // arbitrary query aliases, password fields or fragments to another page.
  for (const name of ['api_base', 'view']) {
    const value = input.get(name);
    if (value !== null) output.set(name, value);
  }
  return output.size ? `?${output}` : '';
}
export function readResetToken(search: string) {
  const token = new URLSearchParams(search).get(resetTokenParameter);
  if (!token) return { value: null, problem: 'This reset link is missing its token.' };
  if (token.length < 20 || token.length > 512)
    return { value: null, problem: 'This reset link is invalid. Please request a new link.' };
  return { value: token, problem: '' };
}

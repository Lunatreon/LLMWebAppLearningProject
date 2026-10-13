export function localDateKey(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function validDateKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T12:00:00`).getTime()) &&
    localDateKey(new Date(`${value}T12:00:00`)) === value
  );
}
export function shiftedDateKey(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}
export function formattedJournalDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'full' },
) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${value}T12:00:00`));
}
export function journalWordTotal(content: string) {
  return content.trim() ? content.trim().split(/\s+/).length : 0;
}
export function historyItem(entry: import('./types').JournalEntry) {
  const compact = entry.content.replace(/\s+/g, ' ').trim();
  return {
    entry_date: entry.entry_date,
    excerpt: compact.length > 120 ? `${compact.slice(0, 117)}...` : compact,
    word_count: journalWordTotal(entry.content),
    suggestion_count: entry.suggestions.length,
    updated_at: entry.updated_at || '',
  };
}

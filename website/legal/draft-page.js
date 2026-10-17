(async () => {
  const status = document.querySelector('#status');
  const text = document.querySelector('#terms-text');
  try {
    // Relative URLs also work under React's /reference/ bridge.
    const response = await fetch('agb-draft.txt', { cache: 'no-store' });
    if (!response.ok) throw new Error('load failed');
    const content = await response.text();
    // Operator-edited text is always displayed literally, never executed as HTML.
    text.textContent = content;
    text.hidden = false;
    status.hidden = true;
  } catch {
    status.textContent = 'Die AGB konnten nicht geladen werden. Bitte die Seite neu laden oder die Textdatei über den Link oben öffnen.';
  }
})();

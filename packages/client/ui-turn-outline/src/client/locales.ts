/** Turn outline copy owned by this plugin. */
export const en = {
  total: 'Indexed turns: {total}', older: 'Older turns', newest: 'Newest turns',
  loadingPage: 'Loading turn index…', failedPage: 'Turn index could not be loaded. Change the search or return to the newest turns to retry.',
  title: 'Turn outline', search: 'Search turns', empty: 'No turns yet.', unavailable: 'Turn outline is unavailable.',
  turn: 'Turn {turn}', untitled: 'No user text', open: 'Open in conversation', loading: 'Loading history…',
  failed: 'This turn could not be opened. Try loading older history and retry.',
  running: 'Running', completed: 'Completed', aborted: 'Cancelled', blocked: 'Blocked', error: 'Failed',
  interrupted: 'Interrupted', 'max-tokens': 'Output limit reached',
}
/** Locale keys used by the outline. */
export type OutlineKey = keyof typeof en

const KEY = 'aw.swipeHintSeen';

/** True once the one-time "swipe me" nudge on the first list row has played. */
export function swipeHintSeen(): boolean {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    return localStorage.getItem(KEY) !== null;
  } catch {
    return true;
  }
}

export function markSwipeHintSeen() {
  try {
    localStorage.setItem(KEY, JSON.stringify(true));
  } catch {
    // Storage unavailable; the nudge may play again next visit.
  }
}

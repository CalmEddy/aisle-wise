/**
 * Developer-only controls (for example "clear where this item is") stay out of
 * the shipped UI. Turn them on with `?debug` in the address or by saving
 * `aw.debug` as true in localStorage.
 */
export function isDebug(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('debug')) return true;
    const v = localStorage.getItem('aw.debug');
    return v === 'true' || v === '1';
  } catch {
    return false;
  }
}

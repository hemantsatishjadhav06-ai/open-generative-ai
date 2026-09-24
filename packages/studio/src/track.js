// Bridge to the host app's analytics (lib/analytics.js installs
// window.__caTrack). Keeps this package free of app-level imports; a no-op
// when the host has not installed a tracker.
export function track(event, props) {
  if (typeof window !== 'undefined' && typeof window.__caTrack === 'function') {
    try {
      window.__caTrack(event, props);
    } catch {
      // analytics must never break the studio
    }
  }
}

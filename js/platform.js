// Browser platform integration: theme/motion, storage estimate and persistence request,
// and a safe service-worker update lifecycle (pending saves are flushed first).

export function applyTheme(settings) {
  const root = document.documentElement;
  const mode = settings?.theme || 'auto';
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode; else delete root.dataset.theme;
  if (settings?.reducedMotion === 'reduce') root.dataset.motion = 'reduce'; else delete root.dataset.motion;
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#121C29' : '#F4F0EF'));
}

export async function storageInfo() {
  const out = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); out.usage = e.usage ?? null; out.quota = e.quota ?? null; }
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
  } catch { /* unsupported */ }
  return out;
}

export async function requestPersistence() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}

/**
 * Register the service worker. `onUpdate(apply)` is called when a new version has been
 * fully installed (precached); `apply()` activates it and reloads.
 */
export function registerServiceWorker({ onUpdate, beforeApply }) {
  if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) return;
  let reloading = false;
  // An update exists only if an earlier version was already running this page. (On a first
  // install some engines report the new worker as controller before it is "installed".)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    const offer = (worker) => onUpdate(async () => {
      const ok = await beforeApply();
      if (!ok) return;
      reloading = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
    if (reg.waiting && hadController) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && hadController) offer(nw); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('Service worker registration failed', e));
}

/** Ask the service worker to look for a new version. @returns {Promise<'available'|'none'|'error'>} */
export async function checkForUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (!reg) return 'error';
    await reg.update();
    return reg.installing || reg.waiting ? 'available' : 'none';
  } catch { return 'error'; }
}

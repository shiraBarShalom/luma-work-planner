// Luma service worker: precaches the same-origin app shell only (no personal data).
// Bump VERSION whenever a shipped shell file changes. A new version installs its complete
// cache first; it activates only when the page asks (after pending saves are flushed) or
// when no page is controlled. Only Luma's own obsolete caches are removed; IndexedDB is
// never touched here.
const VERSION = '2.1.1';
const PREFIX = 'luma-work-planner-shell-';
const CACHE = PREFIX + VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/luma.css',
  './js/main.js', './js/app.js', './js/config.js', './js/clock.js', './js/ids.js', './js/dates.js', './js/seed.js', './js/store.js', './js/db.js',
  './js/commands.js', './js/ui.js', './js/uiPrefs.js', './js/platform.js', './js/notifications.js', './js/swipe.js', './js/editors.js', './js/timegrid.js',
  './js/engine/cache.js', './js/engine/dayTemplates.js', './js/engine/schedule.js', './js/engine/recurrence.js', './js/engine/taskCarryover.js',
  './js/engine/inquiries.js', './js/engine/search.js', './js/engine/alerts.js', './js/engine/header.js',
  './js/data/schema.js', './js/data/safeJson.js', './js/data/validation.js', './js/data/migrations.js', './js/data/backup.js',
  './js/data/importPlan.js', './js/data/prompt.js',
  './js/export/share.js', './js/export/backupExport.js',
  './js/views/common.js', './js/views/today.js', './js/views/agenda.js', './js/views/calendar.js', './js/views/tasks.js',
  './js/views/alerts.js', './js/views/importView.js', './js/views/settings.js',
  './fonts/noto-sans-hebrew-hebrew-400-normal.woff2', './fonts/noto-sans-hebrew-hebrew-500-normal.woff2', './fonts/noto-sans-hebrew-hebrew-600-normal.woff2', './fonts/noto-sans-hebrew-hebrew-700-normal.woff2',
  './fonts/noto-sans-hebrew-latin-400-normal.woff2', './fonts/noto-sans-hebrew-latin-500-normal.woff2', './fonts/noto-sans-hebrew-latin-600-normal.woff2', './fonts/noto-sans-hebrew-latin-700-normal.woff2',
  './assets/banners/banner-dawn.webp', './assets/banners/banner-dawn-alternate.webp', './assets/banners/banner-day.webp', './assets/banners/banner-sunset.webp', './assets/banners/banner-night.webp',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  // addAll is atomic: if any file fails, this version does not install and the previous
  // working shell keeps serving.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Luma makes no cross-origin requests.
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  if (req.mode === 'navigate') {
    // Offline-first navigation: serve the cached shell; fall back to network if missing.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('./index.html')) || fetch(req);
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});

// Tapping a Luma notification focuses an open window or opens the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./#/home');
  })());
});

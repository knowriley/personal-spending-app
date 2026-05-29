// MoneyHabits v2 service worker.
//
// Two named caches, both keyed by BUILD_HASH:
//   - shell cache  : index.html, manifest, CSS, icons, splash, favicon
//                    (precached on install; served cache-first)
//   - data cache   : /api/*.json
//                    (lazily populated; served stale-while-revalidate)
//
// Versioning is cache-name-based, not URL-based. The BUILD_HASH suffix on
// asset URLs (?v=...) exists for HTTP-cache busting in the browser; the SW
// stores entries keyed by clean URL and uses ignoreSearch:true so any ?v=
// variant matches. New deploys produce a new BUILD_HASH → new cache names
// → activate handler deletes the old caches.

const BUILD_HASH  = '__BUILD_HASH__';
const SHELL_CACHE = `moneyhabits-shell-${BUILD_HASH}`;
const DATA_CACHE  = `moneyhabits-data-${BUILD_HASH}`;

const SHELL_URLS = __SHELL_URLS__;

self.addEventListener('install', event => {
  // Activate this build immediately instead of waiting for every old client
  // to close. Without this, a new SW sits in "waiting" behind the previous
  // one indefinitely on an installed PWA (the home-screen app is never fully
  // closed), so deploys never reach the device. Paired with clients.claim()
  // in activate, the new build takes over on the next launch.
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;   // ignore cross-origin

  // /api/*.json → stale-while-revalidate against the data cache.
  if (url.pathname.startsWith('/api/') && url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(event.request, DATA_CACHE));
    return;
  }

  // Shell assets (anything under /static/ or the few site-root files) →
  // cache-first against the shell cache.
  if (url.pathname.startsWith('/static/') ||
      url.pathname === '/manifest.json' ||
      url.pathname === '/' ||
      url.pathname === '/index.html') {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // Root navigation (or /index.html) → serve the cached app shell.
  // Other navigations (e.g. /tests/* dev pages, future deep links) pass
  // through to the network so the actual target HTML is fetched.
  if (event.request.mode === 'navigate' &&
      (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(c => c.match('/', { ignoreSearch: true }))
        .then(r => r || fetch(event.request))
    );
    return;
  }

  // Default: passthrough.
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    // Store under the clean URL (no query) so future ?v= variants match.
    const clean = new URL(request.url);
    clean.search = '';
    cache.put(clean.toString(), response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok) {
        const clean = new URL(request.url);
        clean.search = '';
        cache.put(clean.toString(), response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || networkFetch;
}

/* Job Triage — service worker.
   Caches the shell so the app opens without a network, which is most of what
   "feels like an app" actually means on a phone.

   Network-first, not cache-first. A cache-first worker on a single-file app is
   how you end up shipping a fix and having nobody receive it for a week: the
   old copy keeps winning. This tries the network, falls back to the cache when
   offline, and refreshes the cache on every success. The cost is that an
   online launch waits for the network; the benefit is that what you deploy is
   what people run. */
const CACHE = 'job-triage-v1';
const SHELL = ['./', './index.html', './config.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // Only ever cache this app's own shell. API traffic — Supabase, DeepSeek,
  // Anthropic, Apify — must never be served stale, and a cached auth response
  // would be its own kind of bug.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});

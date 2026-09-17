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
  // Activation must not depend on the cache warm-up. addAll is all-or-nothing,
  // so one flaky shell request used to reject the install outright: the new
  // worker never took over and the old copy kept serving pages -- precisely the
  // "nobody receives the fix" failure this file is written to avoid. Warm what
  // we can, tolerate misses, and take over either way.
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))));
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
        // Only a success may replace what is cached. fetch() resolves for 404s
        // and 502s too, so caching unconditionally let a deploy-window error
        // page overwrite a working shell -- and then be served as the offline
        // copy, bricking the app until the next successful online fetch.
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      // respondWith rejects if handed undefined, which surfaces as a service
      // worker error instead of an offline page, so the chain always ends in a
      // real Response.
      .catch(() => caches.match(req)
        .then(hit => hit || caches.match('./index.html'))
        .then(hit => hit || new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
  );
});

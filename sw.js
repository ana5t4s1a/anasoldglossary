// Service worker: makes the app work offline after the first visit.
// Bump CACHE_VERSION whenever you publish changes so students get the new files.
const CACHE_VERSION = 'tech-english-v1';
const APP_SHELL = [
    './',
    './index.html',
    './tailwind.css',
    './style.css',
    './glossary.js',
    './app.js',
    './manifest.webmanifest',
    './icon.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    // App files: network first (always fresh when online), cache as fallback offline
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request).then(hit => hit || caches.match('./index.html')))
        );
        return;
    }

    // Google Fonts: cache first (they never change for a given URL)
    if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
        event.respondWith(
            caches.match(request).then(hit => hit || fetch(request).then(response => {
                const copy = response.clone();
                caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
                return response;
            }))
        );
    }
});

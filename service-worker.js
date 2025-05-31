/* Palabras de Danielle – Service Worker
    -------------------------------------------------
    A very small offline-first SW:
    • On install  – caches the core assets.
    • On activate – deletes any old caches.
    • On fetch    – serves from cache first, then
                    falls back to the network and
                    performs a “cache-update-refresh”.
*/

const CACHE_VERSION = 'v1.2'; // Incremented version due to new asset
const CACHE_NAME    = `palabras-cache-${CACHE_VERSION}`;

// Add or remove files as needed.
// Ensure all paths are correct and start with '/' if they are relative to the root.
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/style.css',
  '/icons/icon-192x192.png',
  '/icons/logo.png', // Added your logo here
  'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js',
  '/dictionary.js',
  '/util.js',
  '/pizarraState.js',
  '/gameLogic.js',
  '/pizarraUi.js',
  '/pizarraSound.js',
  '/peerjs-multiplayer.js',
  '/pizarraPeerConnection.js',
  '/pizarraMatchmaking.js',
  '/main.js'
];

/* ---------- Install ---------- */
self.addEventListener('install', event => {
  console.log(`[SW] Installing ${CACHE_NAME}...`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching core assets:', ASSETS_TO_CACHE);
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] All assets cached. Installation complete.');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[SW] Cache addAll failed:', error);
      })
  );
});

/* ---------- Activate ---------- */
self.addEventListener('activate', event => {
  console.log(`[SW] Activating ${CACHE_NAME}...`);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('palabras-cache-') && k !== CACHE_NAME)
          .map(k => {
            console.log(`[SW] Deleting old cache: ${k}`);
            return caches.delete(k);
          })
      )
    ).then(() => {
      console.log('[SW] Old caches deleted. Activation complete.');
      return self.clients.claim();
    })
  );
});

/* ---------- Fetch ---------- */
self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);

  const isCoreAssetOrCdn = ASSETS_TO_CACHE.some(assetPath => {
    if (assetPath.startsWith('http')) {
        return requestUrl.href === assetPath;
    }
    return requestUrl.pathname === assetPath || (requestUrl.pathname === '/' && assetPath === '/index.html');
  });


  if (isCoreAssetOrCdn) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, networkResponse.clone()));
          }
          return networkResponse;
        }).catch(error => {
          console.error(`[SW] Network fetch failed for ${request.url}:`, error);
        });
      })
    );
  } else {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          return networkResponse;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
  }
});
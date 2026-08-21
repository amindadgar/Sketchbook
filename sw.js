// The service worker exists so the browser will offer to install the game.
//
// It deliberately caches nothing. The world alone is 25MB, and a cache holding
// a stale copy of it would be far more trouble than an offline mode is worth
// for a game that needs a server to play with anyone anyway. The fetch handler
// leaves every request to the network, which is all installability requires.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', () => {});

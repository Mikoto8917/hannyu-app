// 画面ファイルを端末に保存して、電波がなくてもアプリを開けるようにする。
// /api/* は保存しない（一覧の控えは画面側で持つ）。画面を更新したら VERSION を上げる。
const VERSION = 'v1';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'common.js', 'sender.js', 'outbox.js', 'list.js', 'entry.js', 'edit.js',
  'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// つながるときは最新を取りにいき、取れなければ保存しておいたものを使う
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('index.html'))),
  );
});

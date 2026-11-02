/* ==========================================================================
   Service Worker — 只缓存应用外壳，不碰交易所行情接口
   策略：
     导航请求      network-first，断网时回退缓存外壳
     同源静态资源   stale-while-revalidate，版本号参数不影响命中
     跨域请求      不拦截，交易所 API 必须直连拿实时数据
   ========================================================================== */

const VERSION = 'cp-v2';
const SHELL_CACHE = 'cp-shell-' + VERSION;
const RUNTIME_CACHE = 'cp-runtime-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './newcoins.html',
  './manifest.webmanifest',
  './css/style.css',
  './css/newcoins.css',
  './js/config.js',
  './js/datafeed.js',
  './js/analytics.js',
  './js/render.js',
  './js/app.js',
  './js/watch.js',
  './js/kb.js',
  './js/score.js',
  './js/newfeed.js',
  './js/ncrender.js',
  './js/ncapp.js',
  './js/pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 逐个写入，单个失败不影响整体安装
    await Promise.allSettled(SHELL.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 交易所行情必须走网络，缓存会给出过期价格
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  event.respondWith(isHTML ? networkFirst(req) : staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const fallback = await cache.match('./index.html', { ignoreSearch: true });
    if (fallback) return fallback;
    return new Response('离线，且没有可用缓存', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });

  const network = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  return hit || (await network) || new Response('', { status: 504 });
}

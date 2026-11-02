/* ============================================================
   quote.js — 自选股用的轻量行情查询

   自选库是跨页共享的：用户可能在「市场脉搏」加了 BTC，再到「新币雷达」看，
   而 BTC 并不在近 90 天新币池里，于是面板只能显示出币名。
   这里按需向 Binance 现货补查 24h 行情，带多域名回退与短期缓存。

   设计要点：
   - 只在缺价时才发请求，批量一次查完（symbols 参数）
   - 批量被整包拒绝（含无效 symbol 时交易所会 400）则降级为逐个查
   - 查不到的币记一笔失败时间，5 分钟内不再重试，避免反复打接口
   - 结果只在内存里，不写 localStorage
   ============================================================ */
'use strict';

const Quote = (() => {
  const TTL = 60 * 1000;         // 价格有效期
  const RETRY = 5 * 60 * 1000;   // 查不到之后多久再试
  const TIMEOUT = 6000;

  /* 与 config.js 里 Binance 的多域名顺序保持一致：主站 → 官方数据域名 → 分流域名 */
  const HOSTS = [
    'https://api.binance.com',
    'https://data-api.binance.vision',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
    'https://api4.binance.com',
  ];

  const cache = new Map();    // base -> { price, change, ts }
  const failed = new Map();   // base -> ts
  let goodHost = null;
  let inflight = null;

  const up = s => String(s || '').toUpperCase().trim();

  function fresh(base) {
    const c = cache.get(base);
    return !!c && Date.now() - c.ts < TTL;
  }

  /** 取缓存（可能过期，但可以立刻显示） */
  function get(base) {
    return cache.get(up(base)) || null;
  }

  function put(base, row) {
    const price = +row.lastPrice;
    const change = +row.priceChangePercent;
    if (!isFinite(price) || price <= 0) return;
    cache.set(base, { price, change: isFinite(change) ? change : null, ts: Date.now() });
    failed.delete(base);
  }

  function abortable() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    return { signal: ctrl.signal, done: () => clearTimeout(timer) };
  }

  async function fetchBatch(host, bases) {
    const syms = bases.map(b => b + 'USDT');
    const url = host + '/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(syms));
    const a = abortable();
    try {
      const r = await fetch(url, { signal: a.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j)) throw new Error('payload');
      for (const t of j) {
        if (t && t.symbol && t.symbol.endsWith('USDT')) put(t.symbol.slice(0, -4), t);
      }
      return true;
    } finally { a.done(); }
  }

  async function fetchOne(host, base) {
    const a = abortable();
    try {
      const r = await fetch(host + '/api/v3/ticker/24hr?symbol=' + base + 'USDT',
        { signal: a.signal, cache: 'no-store' });
      if (!r.ok) return false;
      const j = await r.json();
      if (j && j.symbol) { put(base, j); return true; }
      return false;
    } catch (e) {
      return false;
    } finally { a.done(); }
  }

  async function run(bases) {
    const todo = bases.filter(b => !fresh(b) &&
      !(failed.get(b) && Date.now() - failed.get(b) < RETRY));
    if (!todo.length) return false;

    const order = goodHost ? [goodHost].concat(HOSTS.filter(h => h !== goodHost)) : HOSTS;
    for (const host of order) {
      try {
        await fetchBatch(host, todo);
        goodHost = host;
        break;
      } catch (e) {
        // 换下一个域名；全部失败就走逐个补查
      }
    }

    const left = todo.filter(b => !cache.has(b));
    if (left.length) {
      const host = goodHost || HOSTS[0];
      const CHUNK = 6;
      for (let i = 0; i < left.length; i += CHUNK) {
        const part = left.slice(i, i + CHUNK);
        await Promise.all(part.map(async b => {
          if (!(await fetchOne(host, b))) failed.set(b, Date.now());
        }));
      }
    }

    return todo.some(b => cache.has(b));
  }

  /** 确保这些币有价，resolve(true) 表示有新数据可用 */
  async function ensure(bases) {
    const list = Array.from(new Set(bases.map(up).filter(Boolean)));
    if (!list.length) return false;
    if (inflight) return inflight;
    inflight = run(list).catch(() => false).then(got => {
      inflight = null;
      return got;
    });
    return inflight;
  }

  return { get, ensure, fresh, clear() { cache.clear(); failed.clear(); } };
})();

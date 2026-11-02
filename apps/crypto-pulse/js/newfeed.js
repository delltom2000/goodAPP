/* ==========================================================================
   NewFeed — 新币数据层
   上线时间来源：OKX(listTime) / Gate(buy_start) / Bitget(openTime)，均为交易所官方字段
   行情来源    ：上述三所 + Binance + Bybit
   官方标签    ：Binance bapi get-products（Seed / Monitoring / bStocks / 赛道标签）+ 流通量
   过滤目标：杠杆代币、代币化股票、稳定币、合成资产、已下架
   ========================================================================== */
const NewFeed = (() => {
  'use strict';

  /* ---------------- 常量 ---------------- */

  const STABLE = new Set([
    'USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'USDP', 'DAI', 'AEUR', 'EUR', 'GBP',
    'USD1', 'USDE', 'USDS', 'RLUSD', 'XUSD', 'USD', 'EURT', 'USDG', 'PYUSD', 'GHO',
    'FRAX', 'LUSD', 'USTC', 'RWUSD', 'USDQ', 'USDR', 'EURC', 'XAUT', 'PAXG',
  ]);

  /* 杠杆代币：LITE3L / DELL3S / PENGU3S / BTC5L 等 */
  const LEVERAGED_RE = /[35][LS]$/;
  const LEVERAGED_RE2 = /(UP|DOWN|BULL|BEAR)$/;

  /* Gate 的代币化股票命名 */
  const EQUITY_NAME_RE = /xStock|Ondo Tokenized|Ondo .*Portfolio|3xLong|3xShort|5xLong|5xShort|Tokenized Stock|Stock Token|Tokenized Securit/i;

  /* Bitget 的合成资产：小写 r 前缀 */
  const SYNTHETIC_RE = /^r[A-Z]/;

  const WINDOWS = [7, 30, 90, 180, 365];
  const DEFAULT_WINDOW = 90;
  const MAX_POOL = 500;

  /* ---------------- 状态 ---------------- */

  const state = {
    windowDays: DEFAULT_WINDOW,
    loading: false,
    lastSync: 0,
    error: null,
    list: [],            // 已评分的新币，按综合分排序
    raw: [],             // 合并后的原始池
    filterStats: {},     // 各过滤条件剔除数量
    sourceStats: {},     // 各数据源返回条数
    kbStats: null,
    offline: false,      // 展示的是本地留存快照
    cachedAt: 0,         // 快照时间点
  };

  const listeners = new Set();
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit(type) { for (const fn of listeners) { try { fn(type, state); } catch (e) { console.warn(e); } } }

  /* ---------------- 工具 ---------------- */

  function fetchJSON(url, timeout = 15000) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .finally(() => { if (timer) clearTimeout(timer); });
  }

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function upper(s) { return String(s || '').toUpperCase().trim(); }

  /** 判断是否应当剔除，返回剔除原因或 null */
  function rejectReason(base, name, extra = {}) {
    const b = upper(base);
    if (!b) return 'empty';
    if (STABLE.has(b)) return 'stable';
    if (LEVERAGED_RE.test(b)) return 'leveraged';
    if (LEVERAGED_RE2.test(b)) return 'leveraged';
    if (EQUITY_NAME_RE.test(name || '')) return 'equity';
    if (SYNTHETIC_RE.test(String(base || ''))) return 'synthetic';
    if (extra.okxCategory && extra.okxCategory !== '1') return 'equity';
    if (Array.isArray(extra.tags) && extra.tags.some(t => /bstock/i.test(t))) return 'equity';
    return null;
  }

  function bump(key) { state.filterStats[key] = (state.filterStats[key] || 0) + 1; }

  /* ---------------- 各所数据拉取 ---------------- */

  /** OKX：现货 instruments（含 listTime 官方上线时间） */
  async function loadOKX() {
    const j = await fetchJSON('https://www.okx.com/api/v5/public/instruments?instType=SPOT');
    const rows = (j.data || []).filter(x => x.quoteCcy === 'USDT' && x.state === 'live');
    const out = new Map();
    for (const r of rows) {
      const base = upper(r.baseCcy);
      if (!base) continue;
      const reason = rejectReason(r.baseCcy, '', { okxCategory: r.instCategory });
      if (reason) { bump('okx_' + reason); continue; }
      out.set(base, { base, listedAt: num(r.listTime) || 0, name: '' });
    }
    state.sourceStats.okx = rows.length;
    return out;
  }

  /** Gate：currency_pairs（buy_start 上线时间 + base_name 用于识别代币化股票） */
  async function loadGate() {
    const rows = await fetchJSON('https://api.gateio.ws/api/v4/spot/currency_pairs');
    const list = Array.isArray(rows) ? rows : [];
    const out = new Map();
    for (const r of list) {
      if (r.quote !== 'USDT') continue;
      if (r.trade_status !== 'tradable') continue;
      const base = upper(r.base);
      if (!base) continue;
      const reason = rejectReason(r.base, r.base_name);
      if (reason) { bump('gate_' + reason); continue; }
      const ts = num(r.buy_start) * 1000;
      out.set(base, { base, listedAt: ts > 0 ? ts : 0, name: r.base_name || '' });
    }
    state.sourceStats.gate = list.filter(x => x.quote === 'USDT').length;
    return out;
  }

  /** Bitget：现货 symbols（openTime 上线时间） */
  async function loadBitget() {
    const j = await fetchJSON('https://api.bitget.com/api/v2/spot/public/symbols');
    const rows = (j.data || []).filter(x => x.quoteCoin === 'USDT' && x.status === 'online');
    const out = new Map();
    for (const r of rows) {
      const base = upper(r.baseCoin);
      if (!base) continue;
      const reason = rejectReason(r.baseCoin, '');
      if (reason) { bump('bitget_' + reason); continue; }
      const ts = num(r.openTime);
      out.set(base, { base, listedAt: ts > 0 ? ts : 0, name: '' });
    }
    state.sourceStats.bitget = rows.length;
    return out;
  }

  /** Binance：官方标签 + 流通量（用于算市值） */
  async function loadBinanceMeta() {
    const out = new Map();
    try {
      const j = await fetchJSON('https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products');
      const rows = (j.data || []).filter(x => x.q === 'USDT' && x.st === 'TRADING');
      for (const r of rows) {
        const base = upper(r.b);
        if (!base) continue;
        const tags = Array.isArray(r.tags) ? r.tags.map(String) : [];
        if (STABLE.has(base)) continue;
        if (LEVERAGED_RE.test(base) || LEVERAGED_RE2.test(base)) continue;
        if (tags.some(t => /bstock/i.test(t))) { bump('binance_equity'); continue; }
        out.set(base, {
          tags,
          circulating: num(r.cs),
          price: num(r.c),
          high24h: num(r.h),
          low24h: num(r.l),
          quoteVolume: num(r.qv),
          open24h: num(r.o),
          name: r.an || '',
        });
      }
      state.sourceStats.binance = rows.length;
    } catch (e) {
      // Binance 内部接口不可用时，退化为公共行情接口（无标签与流通量）
      state.sourceStats.binance = 0;
      state.binanceFallback = true;
      try {
        const rows = await fetchJSON('https://data-api.binance.vision/api/v3/ticker/24hr');
        for (const r of rows) {
          if (!String(r.symbol).endsWith('USDT')) continue;
          const base = upper(String(r.symbol).slice(0, -4));
          if (!base || STABLE.has(base)) continue;
          if (LEVERAGED_RE.test(base) || LEVERAGED_RE2.test(base)) continue;
          out.set(base, {
            tags: [], circulating: 0,
            price: num(r.lastPrice), high24h: num(r.highPrice), low24h: num(r.lowPrice),
            quoteVolume: num(r.quoteVolume), open24h: num(r.openPrice), name: '',
          });
        }
        state.sourceStats.binance = out.size;
      } catch (e2) {
        state.binanceFallback = true;
      }
    }
    return out;
  }

  /** 行情：OKX / Gate / Bybit（Binance 已在上面拿到） */
  async function loadTickers() {
    const ticks = new Map(); // base -> {ex: {price, qv, open, high, low}}

    function put(base, ex, t) {
      const b = upper(base);
      if (!b) return;
      let o = ticks.get(b);
      if (!o) { o = {}; ticks.set(b, o); }
      o[ex] = t;
    }

    const tasks = [
      // OKX 行情
      fetchJSON('https://www.okx.com/api/v5/market/tickers?instType=SPOT').then(j => {
        for (const r of (j.data || [])) {
          if (!String(r.instId).endsWith('-USDT')) continue;
          const base = r.instId.split('-')[0];
          put(base, 'okx', {
            price: num(r.last), qv: num(r.volCcy24h), open: num(r.open24h),
            high: num(r.high24h), low: num(r.low24h),
          });
        }
      }).catch(() => {}),

      // Gate 行情
      fetchJSON('https://api.gateio.ws/api/v4/spot/tickers').then(rows => {
        for (const r of (Array.isArray(rows) ? rows : [])) {
          if (!String(r.currency_pair).endsWith('_USDT')) continue;
          const base = r.currency_pair.split('_')[0];
          const p = num(r.last);
          const chg = num(r.change_percentage);
          const open = chg !== -100 ? p / (1 + chg / 100) : p;
          put(base, 'gate', {
            price: p, qv: num(r.quote_volume), open,
            high: num(r.high_24h), low: num(r.low_24h),
          });
        }
      }).catch(() => {}),

      // Bybit 行情
      fetchJSON('https://api.bybit.com/v5/market/tickers?category=spot').then(j => {
        for (const r of ((j.result && j.result.list) || [])) {
          if (!String(r.symbol).endsWith('USDT')) continue;
          const base = String(r.symbol).slice(0, -4);
          put(base, 'bybit', {
            price: num(r.lastPrice), qv: num(r.turnover24h), open: num(r.prevPrice24h),
            high: num(r.highPrice24h), low: num(r.lowPrice24h),
          });
        }
      }).catch(() => {}),

      // Bitget 行情
      fetchJSON('https://api.bitget.com/api/v2/spot/market/tickers').then(j => {
        for (const r of (j.data || [])) {
          if (!String(r.symbol).endsWith('USDT')) continue;
          const base = String(r.symbol).slice(0, -4);
          put(base, 'bitget', {
            price: num(r.lastPr), qv: num(r.quoteVolume), open: num(r.open),
            high: num(r.high24h), low: num(r.low24h),
          });
        }
      }).catch(() => {}),
    ];

    await Promise.all(tasks);
    return ticks;
  }

  /* ---------------- 合并 ---------------- */

  function buildPool(lists, ticks, bnMeta, kbMap) {
    const { okx, gate, bitget } = lists;
    const now = Date.now();
    const cutoff = state.windowDays * 864e5;
    const agg = new Map();

    function addListing(src, ex) {
      for (const [base, info] of src) {
        let o = agg.get(base);
        if (!o) {
          o = { base, listings: {}, name: info.name || '' };
          agg.set(base, o);
        }
        if (info.listedAt > 0) o.listings[ex] = info.listedAt;
        if (info.name && !o.name) o.name = info.name;
      }
    }
    addListing(okx, 'okx');
    addListing(gate, 'gate');
    addListing(bitget, 'bitget');

    const pool = [];
    let skippedOld = 0, skippedNoTime = 0;

    for (const [base, o] of agg) {
      const times = Object.values(o.listings).filter(t => t > 0);
      if (!times.length) { skippedNoTime++; continue; }
      const listedAt = Math.min(...times);
      const ageMs = now - listedAt;
      if (ageMs > cutoff) { skippedOld++; continue; }
      if (ageMs < 0) continue;

      const tk = ticks.get(base) || {};
      const bn = bnMeta.get(base) || null;

      // 合并行情：按成交额加权，与主站一致（Gate 打 0.35 折扣抑制刷量）
      const EX_W = { binance: 1, okx: 1, bybit: 1, gate: 0.35, bitget: 1 };
      let qv = 0, score = 0, pw = 0, cw = 0;
      const exchanges = {};
      let high24h = 0, low24h = 0;

      for (const [ex, t] of Object.entries(tk)) {
        if (!(t.price > 0) || !(t.qv > 0)) continue;
        const w = EX_W[ex] || 1;
        exchanges[ex] = { price: t.price, qv: t.qv };
        qv += t.qv;
        score += t.qv * w;
        pw += t.price * t.qv;
        const open = t.open > 0 ? t.open : t.price;
        cw += ((t.price - open) / open * 100) * t.qv;
        if (t.high > high24h) high24h = t.high;
        if (t.low > 0 && (low24h === 0 || t.low < low24h)) low24h = t.low;
      }

      // Binance 有而其他所没抓到的，用 Binance 数据兜底
      if (bn && !exchanges.binance) {
        exchanges.binance = { price: bn.price, qv: bn.quoteVolume };
        if (bn.price > 0 && bn.quoteVolume > 0) {
          qv += bn.quoteVolume;
          score += bn.quoteVolume;
          pw += bn.price * bn.quoteVolume;
          const open = bn.open24h > 0 ? bn.open24h : bn.price;
          cw += ((bn.price - open) / open * 100) * bn.quoteVolume;
          if (bn.high24h > high24h) high24h = bn.high24h;
          if (bn.low24h > 0 && (low24h === 0 || bn.low24h < low24h)) low24h = bn.low24h;
        }
      }

      if (!(qv > 0) || !(pw > 0)) continue;

      const price = pw / qv;
      const change24h = cw / qv;

      // 市值：优先 Binance 流通量 × 价格
      let marketCap = 0, circulating = 0;
      if (bn && bn.circulating > 0 && price > 0) {
        circulating = bn.circulating;
        marketCap = circulating * price;
      }

      const kb = kbMap.get(base) || null;
      const histMax = kb && kb.histMax > 0 ? kb.histMax : 0;

      pool.push({
        base,
        name: (bn && bn.name) || o.name || '',
        price,
        quoteVolume: qv,
        scoreVolume: score,
        change24h,
        high24h: high24h || price,
        low24h: low24h || price,
        marketCap,
        circulating,
        exchanges,
        binanceTags: bn ? bn.tags : [],
        listedAt,
        ageDays: ageMs / 864e5,
        snapDays: kb ? kb.snapDays : 0,
        histMax,
        firstPrice: kb && kb.firstPrice > 0 ? kb.firstPrice : price,
        cgId: '',
      });
    }

    state.filterStats.skippedOld = skippedOld;
    state.filterStats.skippedNoTime = skippedNoTime;

    // 成交额排序 → 计算百分位（供无市值时评估关注度）
    pool.sort((a, b) => b.scoreVolume - a.scoreVolume);
    const trimmed = pool.slice(0, MAX_POOL);
    const n = trimmed.length;
    trimmed.forEach((c, i) => {
      c.qvPercentile = n > 1 ? 1 - i / (n - 1) : 0.5;
      c.rank = i + 1;
    });

    return trimmed;
  }

  /* ---------------- 知识库回写与读取 ---------------- */

  async function readKB(bases) {
    const map = new Map();
    if (typeof KB === 'undefined') return map;
    try {
      await KB.open();
      const all = await KB.getAllProjects();
      const want = new Set(bases);
      for (const p of all) {
        if (!want.has(p.base)) continue;
        map.set(p.base, {
          snapDays: p.snapDays || 0,
          firstPrice: p.firstPrice || 0,
          histMax: p.histMax || 0,
        });
      }
      // 对每个币算历史最高价
      for (const [base, rec] of map) {
        const snaps = await KB.getSnaps(base);
        if (snaps.length) {
          let hi = 0;
          for (const s of snaps) if (s.price > hi) hi = s.price;
          rec.histMax = Math.max(hi, rec.histMax);
          rec.snapDays = snaps.length;
        }
      }
    } catch (e) {
      console.warn('[NewFeed] 读取知识库失败', e);
    }
    return map;
  }

  async function writeKB(list) {
    if (typeof KB === 'undefined') return;
    try {
      await KB.open();
      const now = Date.now();
      const today = KB.dayKey(now);
      const lastSnapDay = await KB.getMeta('lastSnapDay');
      const inc = lastSnapDay === today ? 0 : 1;

      const patchList = list.map(c => ({
        base: c.base,
        name: c.name,
        listedAt: c.listedAt,
        exchanges: c.exchanges,
        binanceTags: c.binanceTags,
        price: c.price,
        quoteVolume: c.quoteVolume,
        marketCap: c.marketCap,
        circulating: c.circulating,
        change24h: c.change24h,
        snapDays: (c.snapDays || 0) + inc,
        score: c.score ? { total: c.score.total, rel: c.score.reliability, pot: c.score.potential, grade: c.score.grade } : null,
      }));

      await KB.bulkUpsertProjects(patchList);
      await KB.bulkPutSnaps(list.map(c => ({
        base: c.base, price: c.price, quoteVolume: c.quoteVolume,
        marketCap: c.marketCap, change24h: c.change24h,
      })), now);

      // 当前会话内立即反映新的快照天数，无需回查数据库
      if (inc) {
        for (const c of list) c.snapDays = (c.snapDays || 0) + 1;
        await KB.setMeta('lastSnapDay', today);
      }

      await KB.setMeta('lastSync', now);
      await KB.setMeta('modelVersion', typeof Score !== 'undefined' ? Score.MODEL_VERSION : '');
      await KB.pruneSnaps();
      state.kbStats = await KB.stats();
    } catch (e) {
      console.warn('[NewFeed] 写入知识库失败', e);
    }
  }

  /* ---------------- 主流程 ---------------- */

  /* 原始数据缓存：切换时间窗口时只需本地重算，不必重新打全部接口 */
  let rawCache = null;
  const RAW_TTL = 5 * 60 * 1000;

  /* ---------------- 本地快照（离线兜底） ---------------- */
  const SNAP_KEY = 'cp.snap.new.v1';
  const SNAP_MAX_AGE = 14 * 24 * 3600 * 1000;
  let snapSavedAt = 0;

  function saveSnapshot(list) {
    if (!list || !list.length) return;
    if (Date.now() - snapSavedAt < 60000) return;   // 节流，别每次同步都写盘
    snapSavedAt = Date.now();
    Snap.save(SNAP_KEY, {
      list,
      windowDays: state.windowDays,
      filterStats: state.filterStats,
      sourceStats: state.sourceStats,
    }, state.lastSync || Date.now());
  }

  /** 取回上次成功的榜单；返回 false 表示没有可用快照 */
  function restore() {
    const snap = Snap.load(SNAP_KEY, SNAP_MAX_AGE);
    if (!snap || !snap.data || !Array.isArray(snap.data.list) || !snap.data.list.length) return false;
    const d = snap.data;
    if (WINDOWS.includes(d.windowDays)) state.windowDays = d.windowDays;
    state.list = d.list;
    state.raw = d.list;
    state.filterStats = d.filterStats || {};
    state.sourceStats = d.sourceStats || {};
    state.offline = true;
    state.cachedAt = snap.at;
    state.lastSync = snap.at;
    state.error = null;
    return true;
  }

  async function sync(opts = {}) {
    if (state.loading) return state;
    state.loading = true;
    state.error = null;
    state.filterStats = {};
    state.sourceStats = {};
    emit('loading');

    try {
      const stale = !rawCache || (Date.now() - rawCache.at) > RAW_TTL;
      const needFetch = opts.force || stale;

      let okx, gate, bitget, ticks, bnMeta;

      if (needFetch) {
        // 1) 三所上线时间 + Binance 官方元数据（并行）
        [okx, gate, bitget, bnMeta] = await Promise.all([
          loadOKX().catch(e => { console.warn('OKX instruments 失败', e); return new Map(); }),
          loadGate().catch(e => { console.warn('Gate pairs 失败', e); return new Map(); }),
          loadBitget().catch(e => { console.warn('Bitget symbols 失败', e); return new Map(); }),
          loadBinanceMeta(),
        ]);
        // 2) 行情
        ticks = await loadTickers();
        rawCache = { okx, gate, bitget, ticks, bnMeta, at: Date.now(), sourceStats: { ...state.sourceStats } };
      } else {
        ({ okx, gate, bitget, ticks, bnMeta } = rawCache);
        state.sourceStats = { ...(rawCache.sourceStats || {}) };
      }

      // 3) 知识库历史（每次都读，因为刚可能写入过）
      const allBases = new Set([...okx.keys(), ...gate.keys(), ...bitget.keys()]);
      const kbMap = await readKB([...allBases]);

      // 4) 合并成池
      const pool = buildPool({ okx, gate, bitget }, ticks, bnMeta, kbMap);
      // 所有接口都拿不到时 pool 会为空：这算失败，不能把已有数据覆盖掉
      if (!pool.length) throw new Error('全部数据源不可达');
      state.raw = pool;

      // 5) 评分
      const scored = (typeof Score !== 'undefined')
        ? Score.computeAll(pool)
        : pool.map(c => ({ ...c, score: null }));

      // 按综合分排序
      scored.sort((a, b) => {
        const sa = a.score ? a.score.total : 0;
        const sb = b.score ? b.score.total : 0;
        if (sb !== sa) return sb - sa;
        return b.scoreVolume - a.scoreVolume;
      });
      scored.forEach((c, i) => { c.scoreRank = i + 1; });

      state.list = scored;
      state.lastSync = Date.now();
      state.offline = false;
      state.cachedAt = 0;

      // 6) 回写知识库
      await writeKB(scored);
      saveSnapshot(scored);

      state.loading = false;
      emit('ready');
      return state;
    } catch (e) {
      state.loading = false;
      state.error = e && e.message ? e.message : String(e);
      // 抓不到就退回本地留存，别让榜单空掉
      if (!state.list.length) restore();
      emit('error');
      throw e;
    }
  }

  function invalidateCache() { rawCache = null; }

  function setWindow(days) {
    if (!WINDOWS.includes(days)) return false;
    state.windowDays = days;
    return true;
  }

  function getState() { return state; }

  return { sync, restore, setWindow, getState, on, invalidateCache, WINDOWS, MAX_POOL, DEFAULT_WINDOW };
})();

if (typeof window !== 'undefined') window.NewFeed = NewFeed;

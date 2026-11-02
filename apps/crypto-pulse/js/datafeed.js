/* ============================================================
   datafeed.js — 行情数据层
   多交易所快照合并 → 池化 Top N → Binance WebSocket 增量更新
   ============================================================ */

'use strict';

const DataFeed = (() => {

  /* ---------------- 内部状态 ---------------- */
  const state = {
    coins: new Map(),          // base -> coin
    list: [],                  // 排序后的池
    poolBuilt: false,
    exchangeStatus: {},        // id -> 'ok' | 'fail' | 'loading'
    lastSnapshotAt: 0,
    wsState: 'init',           // init | connecting | live | offline
    wsHits: 0,                 // WebSocket 收到的更新次数
    lastMsgAt: 0,              // 最后一条推送的时间戳
    subscribed: 0,
    metaLoaded: false,
    error: null,
    offline: false,            // 当前展示的是本地留存的历史快照
    cachedAt: 0,               // 快照时间戳（离线时用来标注「几点」）
  };

  let listeners = { update: [], status: [] };
  let ws = null;
  let wsRetry = 0;
  let wsRetryTimer = null;
  let pollTimer = null;
  let dirty = new Set();       // 本帧内有更新的 base
  let flushQueued = false;

  /* ---------------- 事件 ---------------- */
  function on(evt, fn) { (listeners[evt] || (listeners[evt] = [])).push(fn); }
  function emit(evt, payload) { (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); }

  /* ---------------- 池过滤 ---------------- */
  function isEligible(base, quoteVolume) {
    if (!base || base.length === 0 || base.length > 12) return false;
    if (STABLECOINS.has(base)) return false;
    if (LEVERAGED_RE.test(base)) return false;
    if (quoteVolume < CFG.MIN_QUOTE_VOLUME) return false;
    return true;
  }

  /* ---------------- 抓取单家交易所 ---------------- */
  async function fetchExchange(ex) {
    state.exchangeStatus[ex.id] = 'loading';
    try {
      const json = await fetchJSON(ex.urls, 14000);
      const rows = ex.parse(json);
      state.exchangeStatus[ex.id] = 'ok';
      return rows;
    } catch (e) {
      console.warn(`[${ex.label}] 拉取失败:`, e.message);
      state.exchangeStatus[ex.id] = 'fail';
      return [];
    }
  }

  /* ---------------- 合并为统一币种池 ----------------
     难点：同名 base asset 在不同交易所可能是完全不同的代币，
     或某所存在已下架的僵尸订单簿（价格残留在极低值）。
     策略：先按 base 收集全部报价 → 用价格中位数做一致性过滤 →
     剔除偏离中位数 3 倍以上的源 → 剩余源聚合。 */
  function mergeAll(perExchange) {
    /* --- 阶段 1：按 base 收集原始报价 --- */
    const raw = new Map();
    for (const ex of EXCHANGES) {
      const rows = perExchange[ex.id] || [];
      for (const r of rows) {
        if (!isEligible(r.base, r.quoteVolume)) continue;
        if (!(r.price > 0)) continue;
        let arr = raw.get(r.base);
        if (!arr) { arr = []; raw.set(r.base, arr); }
        arr.push({
          exId: ex.id,
          weight: ex.weight,
          price: r.price,
          open: r.open > 0 ? r.open : r.price,
          high: r.high > 0 ? r.high : r.price,
          low: r.low > 0 ? r.low : r.price,
          qv: r.quoteVolume,
        });
      }
    }

    /* --- 阶段 2：一致性过滤 + 聚合 --- */
    const out = [];

    for (const [base, srcs] of raw) {
      let use = srcs;

      if (srcs.length >= 2) {
        const prices = srcs.map(s => s.price).sort((a, b) => a - b);
        const mid = prices.length >> 1;
        const med = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
        const lo = med / 3, hi = med * 3;
        const kept = srcs.filter(s => s.price >= lo && s.price <= hi);
        if (kept.length === 0) continue;    // 全部互相矛盾，无法确认是同一资产
        use = kept;
      }

      // 选成交额最大的源作为 24h 高低点的基准（同一所的窗口才有可比性）
      let mainSrc = use[0];
      for (const s of use) if (s.qv > mainSrc.qv) mainSrc = s;

      let totalQv = 0, score = 0, priceQv = 0, chgQv = 0;
      const srcMap = {};

      for (const s of use) {
        const chg = (s.price - s.open) / s.open * 100;
        totalQv += s.qv;
        score += s.qv * s.weight;
        priceQv += s.price * s.qv;
        chgQv += chg * s.qv;
        srcMap[s.exId] = { p: s.price, q: s.qv, chg };
      }

      if (!(totalQv > 0) || !(priceQv > 0)) continue;

      const price = priceQv / totalQv;
      // 高低点取主源，且必须包住现价，避免显示逻辑错乱
      let high = mainSrc.high;
      let low = mainSrc.low;
      if (high < price) high = price;
      if (low > price || low <= 0) low = price;

      out.push({
        base,
        src: srcMap,
        qv: totalQv,
        score,
        price,
        chg: chgQv / totalQv,
        high,
        low,
      });
    }

    return out.sort((a, b) => b.score - a.score);
  }

  /* ---------------- 构建/更新池 ---------------- */
  function buildPool(merged) {
    const prev = state.coins;
    const pool = merged.slice(0, CFG.POOL_SIZE);
    const next = new Map();

    pool.forEach((o, i) => {
      const base = o.base;
      const old = prev.get(base);
      const price = o.price;
      const chg = o.chg;
      const high = o.high || price;
      const low = o.low > 0 ? o.low : price;

      let coin = old;
      if (!coin) {
        coin = {
          base,
          name: base,
          image: '',
          symbol: base + 'USDT',
          history: [],
        };
      }

      coin.rank = i + 1;
      coin.price = price;
      coin.changePct = chg;
      coin.high = high;
      coin.low = low;
      coin.quoteVolume = o.qv;
      coin.score = o.score;
      coin.src = o.src;
      coin.exCount = Object.keys(o.src).length;
      coin.amplitude = low > 0 ? (high - low) / low * 100 : 0;
      coin.rangePos = high > low ? Math.min(100, Math.max(0, (price - low) / (high - low) * 100)) : 50;
      coin.ts = Date.now();

      // 保留元数据（名称/图标/市值）
      next.set(base, coin);
    });

    state.coins = next;
    state.list = [...next.values()].sort((a, b) => a.rank - b.rank);
    state.poolBuilt = true;
    state.lastSnapshotAt = Date.now();
  }

  /* ---------------- 本地快照（离线兜底） ---------------- */
  const SNAP_KEY = 'cp.snap.main.v1';
  const SNAP_MAX_AGE = 7 * 24 * 3600 * 1000;   // 超过一周的快照不再使用
  const HIDDEN_REFRESH_MS = 30 * 60 * 1000;    // 切到后台后的刷新间隔
  let paused = false;                          // 页面不可见时暂停推送
  let snapSavedAt = 0;

  function saveSnapshot() {
    if (!state.list.length) return;
    // 节流：轮询每 5 秒一次，没必要每次都写盘
    if (Date.now() - snapSavedAt < 60000) return;
    snapSavedAt = Date.now();
    Snap.save(SNAP_KEY, state.list, state.lastSnapshotAt || Date.now());
  }

  /** 用上次成功的数据先铺满界面；返回是否有可用快照 */
  function restoreSnapshot() {
    const snap = Snap.load(SNAP_KEY, SNAP_MAX_AGE);
    if (!snap || !Array.isArray(snap.data) || !snap.data.length) return false;
    const coins = new Map();
    for (const c of snap.data) { if (c && c.base) coins.set(c.base, c); }
    if (!coins.size) return false;
    state.coins = coins;
    state.list = snap.data.slice().sort((a, b) => a.rank - b.rank);
    state.poolBuilt = true;
    state.offline = true;
    state.cachedAt = snap.at;
    state.lastSnapshotAt = state.lastSnapshotAt || snap.at;
    emit('status');
    emit('update', { full: true });
    return true;
  }

  /* ---------------- 全量快照 ---------------- */
  async function refreshSnapshot() {
    const results = await Promise.all(EXCHANGES.map(ex =>
      fetchExchange(ex).then(rows => [ex.id, rows])
    ));
    const perExchange = Object.fromEntries(results);

    const okCount = EXCHANGES.filter(ex => state.exchangeStatus[ex.id] === 'ok').length;
    if (okCount === 0) {
      state.error = '全部数据源不可达';
      emit('status');
      return;
    }

    const merged = mergeAll(perExchange);
    if (merged.length === 0) return;

    buildPool(merged);
    state.error = null;
    state.offline = false;
    state.cachedAt = 0;

    applyMeta();          // 补名称/图标/市值
    saveSnapshot();       // 留存一份，供下次离线时使用
    emit('status');
    emit('update', { full: true });
  }

  /* ---------------- CoinGecko 元数据（名称/图标/市值） ---------------- */
  let cgTried = false;

  async function loadMeta(force) {
    if (cgTried && !force) return;
    cgTried = true;

    // 先读缓存
    const cached = lsGet(CFG.CG_CACHE_KEY, null);
    if (cached && !force && (Date.now() - cached.t) < CFG.CG_CACHE_TTL) {
      state.cgMeta = cached.m;
      state.metaLoaded = true;
      applyMeta();
      emit('update', { full: true });
      return;
    }

    try {
      const pages = [1, 2, 3];
      const results = await Promise.all(pages.map(p =>
        fetchJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}`, 12000)
          .catch(() => [])
      ));

      const meta = {};
      for (const list of results) {
        for (const c of list) {
          if (!c.symbol) continue;
          const key = c.symbol.toUpperCase();
          const cand = {
            name: c.name,
            image: c.image,
            marketCap: c.market_cap,
            cgRank: c.market_cap_rank,
          };
          // 同名 symbol 取市值排名更靠前的
          if (!meta[key] || (cand.cgRank || 1e9) < (meta[key].cgRank || 1e9)) meta[key] = cand;
        }
      }

      if (Object.keys(meta).length > 0) {
        state.cgMeta = meta;
        state.metaLoaded = true;
        lsSet(CFG.CG_CACHE_KEY, { t: Date.now(), m: meta });
        applyMeta();
        emit('update', { full: true });
      }
    } catch (e) {
      console.warn('CoinGecko 元数据加载失败（不影响行情）:', e.message);
    }
  }

  function applyMeta() {
    const meta = state.cgMeta || {};
    for (const coin of state.coins.values()) {
      const m = meta[coin.base];
      if (m) {
        coin.name = m.name || coin.base;
        coin.image = m.image || '';
        coin.marketCap = m.marketCap || null;
        coin.cgRank = m.cgRank || null;
      } else {
        if (!coin.image) coin.image = '';
      }
      coin.turnover = (coin.marketCap && coin.marketCap > 0)
        ? coin.quoteVolume / coin.marketCap * 100
        : null;
    }
  }

  /* ---------------- WebSocket 实时更新 ---------------- */
  function connectWS() {
    if (ws || paused || !window.WebSocket) return;
    // 只订阅 Binance 上有交易的币，其余靠轮询。
    // 注意：Binance 流名必须是「完整交易对 + 计价币」，即 btcusdt@miniTicker，
    // 只用基础资产（btc@miniTicker）会订阅失败且不报错。
    const streams = state.list
      .filter(c => c.src.binance)
      .map(c => (c.base + CFG.QUOTE).toLowerCase());
    if (streams.length === 0) return;

    state.wsState = 'connecting';
    emit('status');

    const endpoints = [
      'wss://stream.binance.com:9443/stream',
      'wss://stream.binance.com:443/stream',
      'wss://data-stream.binance.vision/stream',
    ];
    const url = endpoints[Math.min(wsRetry, endpoints.length - 1)];

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      scheduleRetry();
      return;
    }
    ws = socket;

    const openTimer = setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        try { socket.close(); } catch {}
      }
    }, CFG.WS_TIMEOUT);

    socket.onopen = () => {
      clearTimeout(openTimer);
      wsRetry = 0;
      state.wsState = 'live';
      emit('status');

      // 分批订阅，避免单条消息过大（Binance 限制每条 ≤200 个流）
      const CHUNK = 150;
      let offset = 0;
      const sendNext = () => {
        if (!ws || socket.readyState !== WebSocket.OPEN) return;
        const chunk = streams.slice(offset, offset + CHUNK);
        if (chunk.length === 0) return;
        offset += CHUNK;
        socket.send(JSON.stringify({
          method: 'SUBSCRIBE',
          params: chunk.map(s => s + '@miniTicker'),
          id: offset,
        }));
        if (offset < streams.length) setTimeout(sendNext, 260);
      };
      sendNext();
    };

    socket.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      // 组合流包装：{ stream, data }
      const d = msg.data || msg;
      if (!d || !d.s) return;
      if (d.e !== '24hrMiniTicker') return;

      const base = d.s.endsWith('USDT') ? d.s.slice(0, -4) : null;
      if (!base) return;
      const coin = state.coins.get(base);
      if (!coin) return;

      const price = +d.c;
      if (!(price > 0)) return;

      const open = +d.o;
      const high = +d.h;
      const low = +d.l;
      const qv = +d.q;

      coin.prevPrice = coin.price;
      coin.price = price;
      coin.open = open;
      coin.high = high > 0 ? high : coin.high;
      coin.low = low > 0 ? low : coin.low;
      if (qv > 0) coin.quoteVolume = qv;
      coin.changePct = open > 0 ? (price - open) / open * 100 : coin.changePct;
      coin.amplitude = coin.low > 0 ? (coin.high - coin.low) / coin.low * 100 : coin.amplitude;
      coin.rangePos = coin.high > coin.low
        ? Math.min(100, Math.max(0, (price - coin.low) / (coin.high - coin.low) * 100))
        : 50;
      coin.src.binance = { p: price, q: qv > 0 ? qv : coin.src.binance.q, chg: coin.changePct };
      coin.ts = Date.now();
      coin.turnover = (coin.marketCap && coin.marketCap > 0)
        ? coin.quoteVolume / coin.marketCap * 100 : null;

      state.wsHits++;
      state.lastMsgAt = Date.now();
      state.offline = false;          // 收到实时推送即视为在线
      dirty.add(base);
      queueFlush();
    };

    socket.onclose = () => {
      clearTimeout(openTimer);
      ws = null;
      state.subscribed = 0;
      if (state.wsState === 'live') {
        state.wsState = 'offline';
        emit('status');
      }
      scheduleRetry();
    };

    socket.onerror = () => {
      clearTimeout(openTimer);
      try { socket.close(); } catch {}
    };
  }

  function scheduleRetry() {
    if (paused) return;              // 页面在后台就不重连了，回前台再说
    if (wsRetryTimer) return;
    wsRetry++;
    const delay = Math.min(2000 * Math.pow(1.6, wsRetry), CFG.WS_RETRY_MAX);
    wsRetryTimer = setTimeout(() => {
      wsRetryTimer = null;
      if (!ws) connectWS();
    }, delay);
  }

  function queueFlush() {
    if (flushQueued) return;
    flushQueued = true;
    requestAnimationFrame(() => {
      flushQueued = false;
      const changed = dirty;
      dirty = new Set();
      if (changed.size > 0) emit('update', { partial: true, changed });
    });
  }

  /* ---------------- 生命周期 ---------------- */
  async function start() {
    // 先把上次的数据铺出来，网络慢或不通时界面也不空着
    restoreSnapshot();
    emit('status');
    await refreshSnapshot();

    // 元数据异步加载，不阻塞行情
    loadMeta(false).catch(() => {});

    // 建立 WebSocket
    connectWS();

    // 定期快照（修正 WS 漂移 + 更新池成员）
    // 前台 5 秒一次；切到后台后降到 30 分钟一次，别在后台偷偷跑流量
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (document.hidden && (Date.now() - state.lastSnapshotAt) < HIDDEN_REFRESH_MS) return;
      await refreshSnapshot();
      // 池子变化后重新订阅
      if (state.wsState !== 'live' && !ws) connectWS();
    }, CFG.SNAPSHOT_INTERVAL);
  }

  function stop() {
    clearInterval(pollTimer);
    if (wsRetryTimer) clearTimeout(wsRetryTimer);
    if (ws) { try { ws.close(); } catch {} ws = null; }
    state.wsState = 'offline';
  }

  /* ---------------- 详情走势（15 分钟 × 96 = 24 小时） ---------------- */
  async function fetchCandles(coin) {
    const LIMIT = 96;
    const src = coin.src || {};

    if (src.binance) {
      try {
        const k = await fetchJSON(
          `https://api.binance.com/api/v3/klines?symbol=${coin.base}USDT&interval=15m&limit=${LIMIT}`, 8000);
        if (Array.isArray(k) && k.length > 1) {
          return k.map(x => ({ t: +x[0], c: +x[4] }));
        }
      } catch {}
    }
    if (src.okx) {
      try {
        const j = await fetchJSON(
          `https://www.okx.com/api/v5/market/candles?instId=${coin.base}-USDT&bar=15m&limit=${LIMIT}`, 8000);
        const d = (j && j.data) || [];
        if (d.length > 1) {
          return d.map(x => ({ t: +x[0], c: +x[4] })).reverse();   // OKX 为倒序
        }
      } catch {}
    }
    if (src.bybit) {
      try {
        const j = await fetchJSON(
          `https://api.bybit.com/v5/market/kline?category=spot&symbol=${coin.base}USDT&interval=15&limit=${LIMIT}`, 8000);
        const d = (j && j.result && j.result.list) || [];
        if (d.length > 1) {
          return d.map(x => ({ t: +x[0], c: +x[4] })).reverse();
        }
      } catch {}
    }
    return null;
  }

  /* ---------------- 对外接口 ---------------- */
  /** 页面可见性：切到后台就断开推送、停掉重连，回前台立刻恢复 */
  function setVisible(visible) {
    const next = !visible;
    if (next === paused) return;
    paused = next;
    if (paused) {
      if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
      if (ws) { try { ws.close(); } catch (e) { /* 忽略 */ } ws = null; }
      state.subscribed = 0;
      if (state.wsState === 'live' || state.wsState === 'connecting') {
        state.wsState = 'offline';
        emit('status');
      }
    } else {
      wsRetry = 0;
      connectWS();
    }
  }

  return {
    start,
    stop,
    setVisible,
    on,
    fetchCandles,
    getState: () => state,
    getList: () => state.list,
    getCoin: (base) => state.coins.get(base),
    refresh: refreshSnapshot,
    reloadMeta: () => loadMeta(true),
  };

})();

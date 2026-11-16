/* Public spot OHLCV feeds. A chart always uses one exchange; never splice sources. */
'use strict';
const History = (() => {
  const DAY = 86400000;
  const PERIODS = {
    time: { label: '分时', ms: 300000, limit: 288, binance: '5m', okx: '5m', bybit: '5', gate: '5m', bitget: '5min', kucoin: '5min', line: true },
    five: { label: '五日', ms: 1800000, limit: 240, binance: '30m', okx: '30m', bybit: '30', gate: '30m', bitget: '30min', kucoin: '30min', line: true },
    m15: { label: '15分', ms: 900000, limit: 192, binance: '15m', okx: '15m', bybit: '15', gate: '15m', bitget: '15min', kucoin: '15min' },
    hour: { label: '小时', ms: 3600000, limit: 168, binance: '1h', okx: '1H', bybit: '60', gate: '1h', bitget: '1h', kucoin: '1hour' },
    day: { label: '日K', ms: DAY, limit: 200, binance: '1d', okx: '1Dutc', bybit: 'D', gate: '1d', bitget: '1day', kucoin: '1day' },
    week: { label: '周K', ms: 7 * DAY, limit: 160, binance: '1w', okx: '1Wutc', bybit: 'W', gate: '7d', bitget: '1week', kucoin: '1week' },
    month: { label: '月K', ms: 31 * DAY, limit: 120, binance: '1M', okx: '1Mutc', bybit: 'M', gate: '1d', bitget: '1day', kucoin: '1day' },
  };
  const LABELS = { binance: 'Binance', okx: 'OKX', bybit: 'Bybit', gate: 'Gate', bitget: 'Bitget', htx: 'HTX', kucoin: 'KuCoin' };
  const KEY = 'cp.history.v2';
  const inflight = new Map();
  let memory = null;
  function cache() {
    if (memory) return memory;
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY));
      memory = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { memory = {}; }
    return memory;
  }
  function peek(base, period) {
    const value = cache()[base + ':' + period];
    if (!value || !LABELS[value.source] || value.period !== period || !Number.isFinite(value.fetchedAt) || value.fetchedAt <= 0 || !Array.isArray(value.points)) return null;
    const points = value.points.filter(p => p && ['t','o','h','l','c','v'].every(k => Number.isFinite(p[k])) && p.t > 0 && Math.min(p.o,p.h,p.l,p.c) > 0 && p.v >= 0 && p.h >= Math.max(p.o,p.c) && p.l <= Math.min(p.o,p.c)).sort((a,b) => a.t-b.t);
    if (points.length < 2) return null;
    return { ...value, points, asOf: points[points.length - 1].t, cached: true, stale: true };
  }
  function save(base, period, value) {
    const all = cache();
    all[base + ':' + period] = value;
    const keys = Object.keys(all).sort((a, b) => all[b].fetchedAt - all[a].fetchedAt);
    keys.slice(24).forEach(key => delete all[key]);
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* Memory cache still works. */ }
  }
  function normalize(rows, source) {
    if (!Array.isArray(rows)) return [];
    const unique = new Map();
    for (let row of rows) {
      if (source === 'htx' && row && typeof row === 'object') {
        row = [row.id, row.open, row.high, row.low, row.close, row.amount];
      }
      if (!Array.isArray(row)) continue;
      let t, o, h, l, c, v;
      if (source === 'gate') [t, , c, h, l, o, v] = row;
      else if (source === 'kucoin') [t, o, c, h, l, v] = row;
      else [t, o, h, l, c, v] = row;
      const p = { t: +t * (['gate', 'kucoin', 'htx'].includes(source) ? 1000 : 1), o: +o, h: +h, l: +l, c: +c, v: +v };
      if (![p.t, p.o, p.h, p.l, p.c, p.v].every(Number.isFinite) || p.t <= 0 || Math.min(p.o, p.h, p.l, p.c) <= 0 || p.v < 0) continue;
      if (p.h < Math.max(p.o, p.c) || p.l > Math.min(p.o, p.c) || p.h < p.l) continue;
      unique.set(p.t, p);
    }
    return [...unique.values()].sort((a, b) => a.t - b.t);
  }
  function months(points) {
    const groups = new Map();
    for (const p of points) {
      const d = new Date(p.t), t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const prev = groups.get(t);
      if (prev) { prev.h = Math.max(prev.h, p.h); prev.l = Math.min(prev.l, p.l); prev.c = p.c; prev.v += p.v; }
      else groups.set(t, { ...p, t });
    }
    const result = [...groups.values()];
    // A limited daily window may start mid-month: discard that partial first month.
    if (result.length && points[0].t !== result[0].t) result.shift();
    return result;
  }
  function requestURLs(source, base, period) {
    const p = PERIODS[period], b = encodeURIComponent(base);
    const count = period === 'month' && ['gate', 'bitget', 'kucoin'].includes(source) ? 1000 : p.limit;
    const now = Date.now();
    switch (source) {
      case 'binance': return EXCHANGES.find(ex => ex.id === 'binance').urls.map(url => new URL(url).origin + `/api/v3/klines?symbol=${b}USDT&interval=${p.binance}&limit=${count}`);
      case 'okx': return [`https://www.okx.com/api/v5/market/candles?instId=${b}-USDT&bar=${p.okx}&limit=${Math.min(count, 300)}`];
      case 'bybit': return [`https://api.bybit.com/v5/market/kline?category=spot&symbol=${b}USDT&interval=${p.bybit}&limit=${count}`];
      case 'gate': return [`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${b}_USDT&interval=${p.gate}&limit=${count}`];
      case 'bitget': return [`https://api.bitget.com/api/v2/spot/market/candles?symbol=${b}USDT&granularity=${p.bitget}&limit=${count}`];
      case 'kucoin': return [`https://api.kucoin.com/api/v1/market/candles?symbol=${b}-USDT&type=${p.kucoin}&startAt=${Math.floor((now - (count + 1) * (period === 'month' ? DAY : p.ms)) / 1000)}&endAt=${Math.floor(now / 1000)}`];
      case 'htx': return [`https://api.huobi.pro/market/history/kline?symbol=${b.toLowerCase()}usdt&period=${({time:'5min',five:'30min',m15:'15min',hour:'60min',day:'1day',week:'1week',month:'1mon'})[period]}&size=${count}`];
      default: return [];
    }
  }
  async function fromSource(source, coin, period, stop, errors) {
    for (const url of requestURLs(source, coin.base, period)) {
      if (stop.signal.aborted) throw new Error('cancelled');
      const ctrl = new AbortController();
      const abort = () => ctrl.abort();
      stop.signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 6000);
      try {
        const response = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const json = await response.json();
        const code = source === 'bybit' ? json.retCode : source === 'htx' ? json.status : json.code;
        const success = ({ okx: '0', bybit: '0', bitget: '00000', htx: 'ok', kucoin: '200000' })[source];
        if (success && String(code) !== success) throw new Error(`API ${code}: ${json.msg || json.retMsg || json['err-msg'] || 'rejected'}`);
        const rows = source === 'binance' || source === 'gate' ? json : source === 'bybit' ? json.result && json.result.list : json.data;
        let points = normalize(rows, source);
        if (period === 'month' && ['gate', 'bitget', 'kucoin'].includes(source)) points = months(points);
        points = points.slice(-PERIODS[period].limit);
        if (points.length < 2) throw new Error('no valid candles');
        const last = points[points.length - 1];
        // Additional exchanges must agree with the current asset quote (same-symbol guard).
        if (!coin.src?.[source] && coin.price > 0 && (last.c / coin.price > 3 || last.c / coin.price < 1 / 3)) throw new Error('price identity mismatch');
        const fetchedAt = Date.now();
        return { points, source, host: new URL(url).hostname, period, fetchedAt, asOf: last.t, cached: false,
          stale: fetchedAt - last.t > PERIODS[period].ms * 2, aggregated: period === 'month' && ['gate', 'bitget', 'kucoin'].includes(source) };
      } catch (e) {
        if (!stop.signal.aborted) errors.push({ source, host: new URL(url).hostname, error: e.message });
      } finally {
        clearTimeout(timer);
        stop.signal.removeEventListener('abort', abort);
      }
    }
    throw new Error(source + ' unavailable');
  }
  async function run(coin, period, source) {
    const saved = peek(coin.base, period);
    const errors = [], old = [], stop = new AbortController();
    const all = Object.keys(LABELS);
    const sources = source === 'auto' ? all.sort((a, b) => (+!!coin.src?.[b]) - (+!!coin.src?.[a])) : [source];
    const attempts = sources.map(id => fromSource(id, coin, period, stop, errors).then(result => {
      if (result.stale) { old.push(result); throw new Error('old history'); }
      return result;
    }));
    let value;
    try { value = await Promise.any(attempts); }
    catch {
      const candidates = [...old, ...(saved ? [saved] : [])].sort((a, b) => b.asOf - a.asOf || b.fetchedAt - a.fetchedAt);
      value = candidates[0];
    } finally { stop.abort(); }
    if (!value) return { points: [], period, errors, unavailable: true };
    if (!value.cached) save(coin.base, period, value);
    return { ...value, errors, requestedSource: source };
  }
  function load(coin, period = 'time', source = 'auto', force = false) {
    if (!PERIODS[period] || (source !== 'auto' && !LABELS[source])) return Promise.reject(new Error('Invalid chart selection'));
    const key = coin.base + ':' + period + ':' + source;
    const saved = peek(coin.base, period);
    if (!force && saved && (source === 'auto' || saved.source === source) && Date.now() - saved.fetchedAt < 60000 && Date.now() - saved.asOf <= PERIODS[period].ms * 2) return Promise.resolve({ ...saved, stale: false });
    if (inflight.has(key)) return inflight.get(key);
    const promise = run(coin, period, source).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }
  return { PERIODS, LABELS, load, peek, normalize, months };
})();

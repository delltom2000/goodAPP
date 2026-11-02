/* ============================================================
   config.js — 全局配置 / 交易所适配器 / 格式化工具
   ============================================================ */

'use strict';

const CFG = {
  QUOTE: 'USDT',               // 统一计价币种
  POOL_SIZE: 500,              // 目标池大小：最活跃的 500 个币
  MIN_QUOTE_VOLUME: 5000,      // 成交额低于此值不入池（防僵尸币）
  SNAPSHOT_INTERVAL: 5000,     // REST 快照轮询（毫秒）
  WS_TIMEOUT: 8000,            // WebSocket 建连超时
  WS_RETRY_MAX: 30000,         // 重连最大退避
  CG_CACHE_KEY: 'cp.cgmeta.v1',
  CG_CACHE_TTL: 6 * 3600 * 1000,
  WATCH_KEY: 'cp.watch.v1',
  PALETTE_KEY: 'cp.palette.v1',
  DENSITY_KEY: 'cp.density.v1',
  MAX_ROWS_RENDERED: 120,      // 首屏渲染行数，滚动/点击加载更多
  ROW_BATCH: 120,
  BINANCE_LOGO: 'https://bin.bnbstatic.com/static/assets/logos/{BASE}.png',
};

/* 稳定币与法币代币：不属于「加密货币行情」分析对象 */
const STABLECOINS = new Set([
  'USDC','FDUSD','TUSD','BUSD','USDP','DAI','AEUR','EUR','GBP','JPY','TRY','BRL',
  'USD1','USDE','USDS','RLUSD','XUSD','USD','PAXG','XAUT','GYEN','EURI','AUD',
  'BIDR','IDRT','BKRW','NGN','RUB','UAH','ZAR','PLN','RON','ARS','MXN','CZK',
]);

/* 杠杆代币 / 合成代币特征 */
const LEVERAGED_RE = /(?:^|[0-9])(UP|DOWN|BULL|BEAR|[35]L|[35]S)$/;

/* ---------------- 交易所适配器 ---------------- */
/* weight: 成交额在排序中的可信权重；price 参与加权均价 */
const EXCHANGES = [
  {
    id: 'binance',
    label: 'Binance',
    weight: 1.0,
    ws: true,
    /* 多域名顺序回退：主站不通时自动换备用域名。
       data-api.binance.vision 是官方公开数据域名，不需 key，国内通常比主站更容易连；
       api1~api4 是官方分流域名，被污染的概率低于主站。 */
    urls: [
      'https://api.binance.com/api/v3/ticker/24hr',
      'https://data-api.binance.vision/api/v3/ticker/24hr',
      'https://api1.binance.com/api/v3/ticker/24hr',
      'https://api2.binance.com/api/v3/ticker/24hr',
      'https://api3.binance.com/api/v3/ticker/24hr',
      'https://api4.binance.com/api/v3/ticker/24hr',
    ],
    parse(json) {
      const out = [];
      for (const t of json) {
        if (!t.symbol || !t.symbol.endsWith('USDT')) continue;
        out.push({
          base: t.symbol.slice(0, -4),
          price: +t.lastPrice,
          open: +t.openPrice,
          high: +t.highPrice,
          low: +t.lowPrice,
          quoteVolume: +t.quoteVolume,
        });
      }
      return out;
    },
  },
  {
    id: 'okx',
    label: 'OKX',
    weight: 1.0,
    ws: false,
    urls: ['https://www.okx.com/api/v5/market/tickers?instType=SPOT'],
    parse(json) {
      const out = [];
      for (const t of (json.data || [])) {
        if (!t.instId || !t.instId.endsWith('-USDT')) continue;
        out.push({
          base: t.instId.split('-')[0],
          price: +t.last,
          open: +t.open24h,
          high: +t.high24h,
          low: +t.low24h,
          quoteVolume: +t.volCcy24h,
        });
      }
      return out;
    },
  },
  {
    id: 'bybit',
    label: 'Bybit',
    weight: 1.0,
    ws: false,
    urls: ['https://api.bybit.com/v5/market/tickers?category=spot'],
    parse(json) {
      const out = [];
      const list = (json.result && json.result.list) || [];
      for (const t of list) {
        if (!t.symbol || !t.symbol.endsWith('USDT')) continue;
        out.push({
          base: t.symbol.slice(0, -4),
          price: +t.lastPrice,
          open: +t.prevPrice24h,
          high: +t.highPrice24h,
          low: +t.lowPrice24h,
          quoteVolume: +t.turnover24h,
        });
      }
      return out;
    },
  },
  {
    id: 'gate',
    label: 'Gate',
    weight: 0.35,   // 存在刷量，排序权重打折
    ws: false,
    urls: ['https://api.gateio.ws/api/v4/spot/tickers'],
    parse(json) {
      const out = [];
      for (const t of json) {
        if (!t.currency_pair || !t.currency_pair.endsWith('_USDT')) continue;
        const price = +t.last;
        const chgPct = +t.change_percentage;
        // Gate 不直接给开盘价，由涨跌幅反推
        const open = (isFinite(chgPct) && chgPct > -100) ? price / (1 + chgPct / 100) : price;
        out.push({
          base: t.currency_pair.split('_')[0],
          price,
          open,
          high: +t.high_24h,
          low: +t.low_24h,
          quoteVolume: +t.quote_volume,
        });
      }
      return out;
    },
  },
];

/* ---------------- 格式化工具 ---------------- */

/** 价格格式化：按量级自适应小数位 */
function fmtPrice(p) {
  if (!isFinite(p) || p === 0) return '--';
  const a = Math.abs(p);
  if (a >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 100)  return p.toFixed(2);
  if (a >= 1)    return p.toFixed(3);
  if (a >= 0.1)  return p.toFixed(4);
  if (a >= 0.01) return p.toFixed(5);
  if (a >= 0.0001) return p.toFixed(6);
  return p.toFixed(8);
}

/** 金额缩写：$1.23B / $456.7M / $12.3K */
function fmtMoney(v) {
  if (!isFinite(v) || v === 0) return '--';
  const a = Math.abs(v);
  if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9)  return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6)  return '$' + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3)  return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}

/** 百分比 */
function fmtPct(v, digits = 2) {
  if (!isFinite(v)) return '--';
  return (v >= 0 ? '+' : '') + v.toFixed(digits) + '%';
}

/** 走势方向 CSS 类 */
function dirClass(v) {
  if (!isFinite(v) || Math.abs(v) < 1e-9) return 'flat';
  return v > 0 ? 'up' : 'down';
}

/** 数字紧凑显示（用于大数值，不带货币符号） */
function fmtNum(v, digits = 0) {
  if (!isFinite(v)) return '--';
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 时间点：21:07 / 21:07:36（本地时区）。用于顶栏「数据更新于几点」 */
function fmtClock(ts, withSec) {
  if (!ts) return '--:--';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--';
  const p = n => (n < 10 ? '0' : '') + n;
  const s = p(d.getHours()) + ':' + p(d.getMinutes());
  return withSec ? s + ':' + p(d.getSeconds()) : s;
}

/** 带超时与多源回退的 fetch
 *  timeout 默认 6 秒：国内访问境外接口常见表现是"连上但不返回"，
 *  等太久会让整个首屏卡住，宁可快速切到下一个源。 */
async function fetchJSON(urls, timeout = 6000) {
  const list = Array.isArray(urls) ? urls : [urls];
  let lastErr;
  for (const url of list) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  throw lastErr || new Error('fetch failed');
}

/** 轻量节流：按帧合并 */
function rafThrottle(fn) {
  let queued = false;
  return function (...args) {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn.apply(this, args);
    });
  };
}

/** 从 localStorage 安全读取 */
function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 忽略配额错误 */ }
}

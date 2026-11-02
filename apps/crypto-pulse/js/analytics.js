/* ============================================================
   analytics.js — 分析引擎
   全部指标基于池内实时数据现算，口径在注释中写明
   ============================================================ */

'use strict';

const Analytics = (() => {

  /* ---------------- 基础统计 ---------------- */
  function median(arr) {
    if (arr.length === 0) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function quantile(arr, q) {
    if (arr.length === 0) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  /* ---------------- 涨跌分布分箱 ----------------
     在中间密集区细分、两侧稀疏区粗分，避免长尾把柱状图压扁 */
  const BINS = [
    { from: -Infinity, to: -20, label: '<-20' },
    { from: -20, to: -15, label: '-20~-15' },
    { from: -15, to: -10, label: '-15~-10' },
    { from: -10, to: -7,  label: '-10~-7' },
    { from: -7,  to: -5,  label: '-7~-5' },
    { from: -5,  to: -3,  label: '-5~-3' },
    { from: -3,  to: -1,  label: '-3~-1' },
    { from: -1,  to: 1,   label: '-1~1' },
    { from: 1,   to: 3,   label: '1~3' },
    { from: 3,   to: 5,   label: '3~5' },
    { from: 5,   to: 7,   label: '5~7' },
    { from: 7,   to: 10,  label: '7~10' },
    { from: 10,  to: 15,  label: '10~15' },
    { from: 15,  to: 20,  label: '15~20' },
    { from: 20,  to: Infinity, label: '>20' },
  ];

  function buildHistogram(list) {
    const counts = new Array(BINS.length).fill(0);
    for (const c of list) {
      const v = c.changePct;
      for (let i = 0; i < BINS.length; i++) {
        if (v >= BINS[i].from && v < BINS[i].to) { counts[i]++; break; }
      }
    }
    return BINS.map((b, i) => ({
      label: b.label,
      count: counts[i],
      mid: (isFinite(b.from) ? b.from : b.to - 10) / 2 + (isFinite(b.to) ? b.to : b.from + 10) / 2,
    }));
  }

  /* ---------------- 异动信号 ---------------- */
  const SIGNAL_TYPES = {
    surge:  { label: '急涨', color: 'surge' },
    plunge: { label: '急跌', color: 'plunge' },
    volume: { label: '放量', color: 'volume' },
    volat:  { label: '异动', color: 'volat' },
    nearHigh: { label: '逼近日高', color: 'near-h' },
    nearLow:  { label: '逼近日低', color: 'near-l' },
  };

  function detectSignals(list, ctx) {
    const out = [];
    const volFloor = Math.max(500000, ctx.p60Volume || 0);   // 用池内 60 分位成交额作为流动性门槛

    for (const c of list) {
      if (c.quoteVolume < volFloor) continue;

      const chg = c.changePct;
      const amp = c.amplitude;
      const to = c.turnover;
      let best = null;

      // 1. 急涨 / 急跌：24h 变动幅度显著
      if (chg >= 12) {
        best = { type: 'surge', strength: Math.min(100, 45 + chg * 1.8), note: `24h ${fmtPct(chg)}` };
      } else if (chg <= -12) {
        best = { type: 'plunge', strength: Math.min(100, 45 + Math.abs(chg) * 1.8), note: `24h ${fmtPct(chg)}` };
      }

      // 2. 放量：日换手率极高（成交额相对市值），说明资金异常涌入
      if (to !== null && to !== undefined && to >= 40) {
        const s = Math.min(100, 40 + to * 0.7);
        if (!best || s > best.strength) {
          best = { type: 'volume', strength: s, note: `换手 ${to.toFixed(1)}%` };
        }
      }

      // 3. 振幅异常：日内高低差过大
      if (amp >= 22) {
        const s = Math.min(100, 38 + amp * 1.4);
        if (!best || s > best.strength) {
          best = { type: 'volat', strength: s, note: `振幅 ${amp.toFixed(1)}%` };
        }
      }

      // 4. 逼近日高：价格贴在 24h 高点且当日强势
      if (c.rangePos >= 93 && chg >= 3) {
        const s = 55 + c.rangePos * 0.35;
        if (!best || s > best.strength) {
          best = { type: 'nearHigh', strength: s, note: `位于日高 ${c.rangePos.toFixed(0)}%` };
        }
      }

      // 5. 逼近日低：价格贴在 24h 低点且当日弱势
      if (c.rangePos <= 7 && chg <= -3) {
        const s = 55 + (100 - c.rangePos) * 0.35;
        if (!best || s > best.strength) {
          best = { type: 'nearLow', strength: s, note: `位于日低 ${c.rangePos.toFixed(0)}%` };
        }
      }

      if (best) {
        out.push({
          base: c.base,
          coin: c,
          type: best.type,
          strength: best.strength,
          note: best.note,
        });
      }
    }

    return out.sort((a, b) => b.strength - a.strength).slice(0, 40);
  }

  /* ---------------- 主计算 ---------------- */
  function compute(list) {
    const n = list.length;
    if (n === 0) return null;

    let totalVolume = 0;
    let totalMarketCap = 0;
    let mcCovered = 0;
    let up = 0, down = 0, flat = 0;
    let upVolume = 0, downVolume = 0;
    let sumChg = 0;
    let sumAmp = 0;
    let weightedChgNum = 0;
    let weightedChgDen = 0;

    const chgArr = [];
    const ampArr = [];
    const volArr = [];
    const turnoverArr = [];

    // 市值分层
    const tiers = {
      large: { label: '大市值 >$10B', count: 0, chgSum: 0, vol: 0 },
      mid:   { label: '中市值 $1-10B', count: 0, chgSum: 0, vol: 0 },
      small: { label: '小市值 <$1B', count: 0, chgSum: 0, vol: 0 },
      na:    { label: '市值未知', count: 0, chgSum: 0, vol: 0 },
    };

    for (const c of list) {
      const chg = c.changePct;
      totalVolume += c.quoteVolume;
      sumChg += chg;
      sumAmp += c.amplitude;
      chgArr.push(chg);
      ampArr.push(c.amplitude);
      volArr.push(c.quoteVolume);

      if (chg > 0.02) { up++; upVolume += c.quoteVolume; }
      else if (chg < -0.02) { down++; downVolume += c.quoteVolume; }
      else flat++;

      weightedChgNum += chg * c.quoteVolume;
      weightedChgDen += c.quoteVolume;

      if (c.marketCap > 0) {
        totalMarketCap += c.marketCap;
        mcCovered++;
      }
      if (c.turnover !== null && c.turnover !== undefined) turnoverArr.push(c.turnover);

      let tier;
      if (!c.marketCap || c.marketCap <= 0) tier = tiers.na;
      else if (c.marketCap >= 1e10) tier = tiers.large;
      else if (c.marketCap >= 1e9) tier = tiers.mid;
      else tier = tiers.small;
      tier.count++;
      tier.chgSum += chg;
      tier.vol += c.quoteVolume;
    }

    const upRatio = up / n;
    const avgChg = sumChg / n;
    const medChg = median(chgArr);
    const weightedChg = weightedChgDen > 0 ? weightedChgNum / weightedChgDen : 0;
    const avgAmp = sumAmp / n;
    const medAmp = median(ampArr);

    /* 市场情绪分 0-100
       = 50 + 50 × [ 0.40×(2×宽度-1) + 0.35×tanh(加权涨跌/3) + 0.25×tanh(中位涨跌/3) ]
       tanh(x/3) 把 ±3% 映射到约 ±0.76，±6% 以上接近饱和 */
    const breadthComp = 2 * upRatio - 1;
    const momComp = Math.tanh(weightedChg / 3);
    const medComp = Math.tanh(medChg / 3);
    const sentiment = Math.max(0, Math.min(100,
      50 + 50 * (0.40 * breadthComp + 0.35 * momComp + 0.25 * medComp)
    ));

    /* 资金流向：以「上涨币种成交额」对「下跌币种成交额」近似多空力量
       这是行业常用的 up-volume / down-volume 口径，属估算值 */
    const flowTotal = upVolume + downVolume;
    const bullishShare = flowTotal > 0 ? upVolume / flowTotal : 0.5;
    const netFlow = upVolume - downVolume;

    /* 集中度：前 10 / 前 50 成交额占比 */
    const sortedByVol = list.slice().sort((a, b) => b.quoteVolume - a.quoteVolume);
    const top10Vol = sortedByVol.slice(0, 10).reduce((s, c) => s + c.quoteVolume, 0);
    const top50Vol = sortedByVol.slice(0, 50).reduce((s, c) => s + c.quoteVolume, 0);

    /* 榜单：设流动性门槛，避免僵尸币霸榜 */
    const liqFloor = Math.max(300000, quantile(volArr, 0.5) * 0.4);
    const liquid = list.filter(c => c.quoteVolume >= liqFloor);

    const gainers = liquid.slice().sort((a, b) => b.changePct - a.changePct).slice(0, 10);
    const losers  = liquid.slice().sort((a, b) => a.changePct - b.changePct).slice(0, 10);
    const volumeLeaders = sortedByVol.slice(0, 10);
    const turnoverLeaders = list
      .filter(c => c.turnover !== null && c.turnover !== undefined && c.quoteVolume >= 1000000)
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, 10);

    const histogram = buildHistogram(list);

    const ctx = { p60Volume: quantile(volArr, 0.6) };
    const signals = detectSignals(list, ctx);

    return {
      n,
      totalVolume,
      totalMarketCap,
      mcCovered,
      up, down, flat,
      upRatio,
      avgChg,
      medChg,
      weightedChg,
      avgAmp,
      medAmp,
      medianTurnover: median(turnoverArr),
      sentiment,
      upVolume,
      downVolume,
      netFlow,
      bullishShare,
      top10Vol,
      top50Vol,
      gainers,
      losers,
      volumeLeaders,
      turnoverLeaders,
      histogram,
      signals,
      tiers: [tiers.large, tiers.mid, tiers.small, tiers.na],
      liqFloor,
    };
  }

  return { compute, median, quantile, SIGNAL_TYPES };

})();

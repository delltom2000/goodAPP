/* ==========================================================================
   Score — 新币评分引擎
   设计原则：
     1. 只用可验证的客观数据（交易所覆盖、官方标签、成交额、市值、回撤）
     2. 每个因子都可解释，前端能把"为什么是这个分"逐条列出来
     3. 缺失数据给中性分并标注，不能因为缺数据就把项目判死
     4. 权重固定、线性可加，不做拟合，避免过拟合和黑箱
   两个维度：
     reliability 可靠性 —— 这个项目"活下来、不作恶"的概率证据
     potential   潜力   —— 是否有资金关注、是否还有上涨空间
   ========================================================================== */
const Score = (() => {
  'use strict';

  const MODEL_VERSION = 'v1.0.2026-11';

  /* 交易所背书权重：越主流的现货市场，上币审核越严 */
  const EX_WEIGHT = { binance: 14, okx: 9, bybit: 7, gate: 6, bitget: 5 };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function round1(v) { return Math.round(v * 10) / 10; }

  /* ---------------- 可靠性因子 ---------------- */

  function fExchange(coin) {
    const src = coin.exchanges || {};
    let s = 0;
    const hit = [];
    for (const [ex, w] of Object.entries(EX_WEIGHT)) {
      if (src[ex]) { s += w; hit.push(ex); }
    }
    s = clamp(s, 0, 32);
    const names = { binance: 'Binance', okx: 'OKX', bybit: 'Bybit', gate: 'Gate', bitget: 'Bitget' };
    if (!hit.length) {
      return { key: 'exchange', label: '交易所背书', score: 0, max: 32, note: '无主流现货市场收录', missing: true };
    }
    return {
      key: 'exchange', label: '交易所背书', score: round1(s), max: 32,
      note: hit.map(x => names[x] || x).join(' · ') + ' 共 ' + hit.length + ' 家',
    };
  }

  function fOfficial(coin) {
    const tags = (coin.binanceTags || []).map(t => String(t).toLowerCase());
    const onBn = !!(coin.exchanges && coin.exchanges.binance) || tags.length > 0;
    const hasMonitor = tags.includes('monitoring');
    const hasSeed = tags.includes('seed');
    if (!onBn) {
      return {
        key: 'official', label: '官方风险信号', score: 9, max: 24,
        note: '未上 Binance，缺少该层审核',
      };
    }
    if (hasMonitor) {
      return {
        key: 'official', label: '官方风险信号', score: 4, max: 24,
        note: 'Binance 已挂 Monitoring 观察标，存在下架风险', flag: 'danger',
      };
    }
    if (hasSeed) {
      return {
        key: 'official', label: '官方风险信号', score: 14, max: 24,
        note: 'Binance Seed 种子标：通过审核但官方提示早期高风险', flag: 'warn',
      };
    }
    return {
      key: 'official', label: '官方风险信号', score: 24, max: 24,
      note: 'Binance 现货在列，无任何风险警示',
    };
  }

  function fLiquidity(coin) {
    const qv = coin.quoteVolume || 0;
    if (!(qv > 0)) {
      return { key: 'liquidity', label: '流动性深度', score: 0, max: 20, note: '无成交额数据', missing: true };
    }
    // 刻度按新币实际区间标定：1万 → 0 分；3160万 → 20 分（对数刻度）
    const s = clamp((Math.log10(qv) - 4) / 3.5 * 20, 0, 20);
    let note;
    if (qv >= 1e8) note = '24h 成交额 $' + (qv / 1e8).toFixed(2) + ' 亿，深度充足';
    else if (qv >= 1e6) note = '24h 成交额 $' + (qv / 1e6).toFixed(1) + ' 百万，可正常进出';
    else if (qv >= 1e5) note = '24h 成交额 $' + (qv / 1e3).toFixed(0) + ' 千，偏薄';
    else note = '24h 成交额仅 $' + qv.toFixed(0) + '，流动性极差';
    return { key: 'liquidity', label: '流动性深度', score: round1(s), max: 20, note, flag: qv < 1e5 ? 'danger' : null };
  }

  function fPersistence(coin) {
    const d = coin.snapDays || 0;
    if (d <= 0) {
      return {
        key: 'persistence', label: '交易持续性', score: 7, max: 14,
        note: '知识库尚无历史快照，按中性计', missing: true,
      };
    }
    const s = clamp(d / 14 * 14, 0, 14);
    return {
      key: 'persistence', label: '交易持续性', score: round1(s), max: 14,
      note: `知识库已连续记录 ${d} 天，${d >= 14 ? '成交稳定' : '样本仍偏少'}`,
    };
  }

  /**
   * 跨所价格一致性。
   * 同一币在不同交易所的报价应当接近。价差小说明市场定价有效率、有真实套利；
   * 价差大则往往意味着流动性割裂、僵尸盘，甚至是不同项目共用了一个代号。
   */
  function fConsistency(coin) {
    const src = coin.exchanges || {};
    const prices = Object.values(src).map(x => x && x.price).filter(p => p > 0);
    if (prices.length < 2) {
      return {
        key: 'consistency', label: '跨所一致性', score: 5, max: 8,
        note: '仅 1 家交易所报价，无法交叉验证', missing: true,
      };
    }
    const hi = Math.max(...prices);
    const lo = Math.min(...prices);
    const spread = (hi - lo) / lo * 100;
    let s, note, flag = null;
    if (spread < 2) { s = 8; note = `${prices.length} 家报价价差 ${spread.toFixed(1)}%，定价一致`; }
    else if (spread < 5) { s = 6; note = `${prices.length} 家报价价差 ${spread.toFixed(1)}%，基本一致`; }
    else if (spread < 15) { s = 3; note = `${prices.length} 家报价价差 ${spread.toFixed(1)}%，存在分歧`; flag = 'warn'; }
    else { s = 0; note = `价差高达 ${spread.toFixed(0)}%，疑似假币或僵尸盘`; flag = 'danger'; }
    return { key: 'consistency', label: '跨所一致性', score: s, max: 8, note, flag };
  }

  function fStability(coin) {
    const c = Math.abs(coin.change24h || 0);
    let s, note, flag = null;
    if (c <= 6) { s = 6; note = '24h 波动 ' + c.toFixed(1) + '%，走势平稳'; }
    else if (c <= 20) { s = 4; note = '24h 波动 ' + c.toFixed(1) + '%，正常波动'; }
    else if (c <= 45) { s = 2; note = '24h 波动 ' + c.toFixed(1) + '%，波动偏大'; flag = 'warn'; }
    else { s = 0; note = '24h 波动 ' + c.toFixed(1) + '%，剧烈异动'; flag = 'danger'; }
    return { key: 'stability', label: '价格稳定性', score: s, max: 6, note, flag };
  }

  /* ---------------- 潜力因子 ---------------- */

  /**
   * 资金关注度。
   * 有市值 → 用换手率（成交额/市值），这是最直接的关注度指标；
   * 无市值 → 退化为「池内成交额百分位」，即在新币池里的相对排名，
   *          仍然可以比较谁更有资金关注，只是精度略低。
   */
  function fAttention(coin) {
    const qv = coin.quoteVolume || 0;
    const mcap = coin.marketCap || 0;

    if (qv > 0 && mcap > 0) {
      const r = qv / mcap;
      let s, note, flag = null;
      if (r >= 0.08 && r <= 0.6) { s = 24; note = `换手 ${(r * 100).toFixed(1)}%，资金关注度健康`; }
      else if (r > 0.6 && r <= 1.5) { s = 18; note = `换手 ${(r * 100).toFixed(1)}%，交易活跃但偏热`; }
      else if (r > 1.5) { s = 10; note = `换手 ${(r * 100).toFixed(1)}%，投机过度，接盘风险高`; flag = 'warn'; }
      else if (r >= 0.03) { s = 14; note = `换手 ${(r * 100).toFixed(1)}%，关注度偏低`; }
      else if (r >= 0.008) { s = 7; note = `换手 ${(r * 100).toFixed(1)}%，交易冷清`; flag = 'warn'; }
      else { s = 2; note = `换手 ${(r * 100).toFixed(2)}%，几乎无人交易`; flag = 'danger'; }
      return { key: 'attention', label: '资金关注度', score: s, max: 24, note, flag };
    }

    // 无市值，用池内百分位
    const pct = typeof coin.qvPercentile === 'number' ? coin.qvPercentile : null;
    if (pct == null) {
      return { key: 'attention', label: '资金关注度', score: 10, max: 24, note: '缺市值与排名数据，按中性计', missing: true };
    }
    let s, note, flag = null;
    if (pct >= 0.9) { s = 22; note = `无公开市值；24h 成交额在新币池内排前 ${Math.round((1 - pct) * 100)}%`; }
    else if (pct >= 0.7) { s = 17; note = `无公开市值；成交额池内排名前 ${Math.round((1 - pct) * 100)}%`; }
    else if (pct >= 0.4) { s = 12; note = `无公开市值；成交额池内中游`; }
    else if (pct >= 0.15) { s = 7; note = '无公开市值；成交额池内偏后'; flag = 'warn'; }
    else { s = 3; note = '无公开市值；成交额池内垫底'; flag = 'danger'; }
    return { key: 'attention', label: '资金关注度', score: s, max: 24, note, flag, missing: !mcap };
  }

  function fMomentum(coin) {
    const c24 = coin.change24h || 0;
    const sinceList = coin.firstPrice > 0 && coin.price > 0 ? (coin.price / coin.firstPrice - 1) * 100 : null;
    let s = 0;
    const parts = [];

    if (c24 > 100) { s += 4; parts.push('24h 暴涨 ' + c24.toFixed(0) + '%（追高风险）'); }
    else if (c24 > 25) { s += 12; parts.push('24h +' + c24.toFixed(0) + '%'); }
    else if (c24 > 5) { s += 16; parts.push('24h 稳健上行 +' + c24.toFixed(1) + '%'); }
    else if (c24 > -5) { s += 8; parts.push('24h 横盘'); }
    else if (c24 > -20) { s += 3; parts.push('24h 回调 ' + c24.toFixed(0) + '%'); }
    else { s += 0; parts.push('24h 大跌 ' + c24.toFixed(0) + '%'); }

    if (sinceList != null) {
      if (sinceList > 0 && sinceList < 300) { s += 6; parts.push('上线以来 +' + sinceList.toFixed(0) + '%'); }
      else if (sinceList >= 300) { s += 2; parts.push('上线以来已涨 ' + sinceList.toFixed(0) + '%（幅度过大）'); }
      else if (sinceList > -50) { s += 4; parts.push('上线以来 ' + sinceList.toFixed(0) + '%'); }
      else { s += 0; parts.push('上线以来 ' + sinceList.toFixed(0) + '%（破发严重）'); }
    }
    s = clamp(s, 0, 22);
    return {
      key: 'momentum', label: '价格动量', score: round1(s), max: 22,
      note: parts.join('，'),
    };
  }

  function fRoom(coin) {
    const mcap = coin.marketCap || 0;
    if (!(mcap > 0)) {
      return { key: 'room', label: '市值空间', score: 10, max: 20, note: '缺市值数据，按中性计', missing: true };
    }
    let s, note;
    if (mcap < 2e7) { s = 20; note = '市值 $' + (mcap / 1e6).toFixed(1) + 'M，弹性最大'; }
    else if (mcap < 1e8) { s = 16; note = '市值 $' + (mcap / 1e6).toFixed(0) + 'M，仍有空间'; }
    else if (mcap < 5e8) { s = 10; note = '市值 $' + (mcap / 1e8).toFixed(2) + '亿，空间中等'; }
    else if (mcap < 2e9) { s = 5; note = '市值 $' + (mcap / 1e8).toFixed(1) + '亿，上升空间有限'; }
    else { s = 2; note = '市值 $' + (mcap / 1e8).toFixed(0) + '亿，已是中大型'; }
    return { key: 'room', label: '市值空间', score: s, max: 20, note };
  }

  function fFreshness(coin) {
    const d = coin.ageDays != null ? coin.ageDays : null;
    if (d == null) {
      return { key: 'freshness', label: '上线新鲜度', score: 5, max: 14, note: '上线时间未知', missing: true };
    }
    let s, note;
    if (d <= 7) { s = 14; note = `上线 ${Math.round(d)} 天，全新标的`; }
    else if (d <= 30) { s = 11; note = `上线 ${Math.round(d)} 天，热度期`; }
    else if (d <= 90) { s = 7; note = `上线 ${Math.round(d)} 天`; }
    else if (d <= 180) { s = 4; note = `上线 ${Math.round(d)} 天，已过热度期`; }
    else { s = 1; note = `上线 ${Math.round(d)} 天`; }
    return { key: 'freshness', label: '上线新鲜度', score: s, max: 14, note };
  }

  function fNarrative(coin) {
    const tags = (coin.binanceTags || []).map(t => String(t).toLowerCase());
    if (!tags.length) {
      return { key: 'narrative', label: '赛道与叙事', score: 4, max: 12, note: '无官方赛道标签，按中性计', missing: true };
    }
    const hot = {
      ai: 4, meme: 3, rwa: 3, layer1_layer2: 3, defi: 2, infrastructure: 2,
      gaming: 2, depin: 3, solana: 2, bsc: 2, launchpool: 3, hodler: 3, megadrop: 3, launchpad: 2,
    };
    let s = 0;
    const hit = [];
    for (const t of tags) {
      if (hot[t]) { s += hot[t]; hit.push(t); }
    }
    s = clamp(s, 0, 12);
    const labelMap = {
      ai: 'AI', meme: 'Meme', rwa: 'RWA', layer1_layer2: 'L1/L2', defi: 'DeFi',
      infrastructure: '基础设施', gaming: '游戏', depin: 'DePIN', solana: 'Solana',
      bsc: 'BSC', launchpool: 'Launchpool', hodler: 'HODLer', megadrop: 'Megadrop', launchpad: 'Launchpad',
    };
    return {
      key: 'narrative', label: '赛道与叙事', score: round1(s), max: 12,
      note: hit.length ? '命中热点：' + hit.map(t => labelMap[t] || t).join('、') : '赛道不在当前热点',
    };
  }

  /**
   * 回撤与位置。
   * 优先用知识库记录的历史最高价算真实回撤；
   * 没有历史时退化为 24h 区间位置（短期趋势强弱），并明确标注。
   */
  function fRecovery(coin) {
    const price = coin.price || 0;
    const histMax = coin.histMax || 0;

    if (histMax > 0 && price > 0) {
      const dd = (price / histMax - 1) * 100;
      let s, note, flag = null;
      if (dd > -30) { s = 3; note = `距知识库最高价 ${dd.toFixed(0)}%，高位需警惕`; flag = 'warn'; }
      else if (dd > -70) { s = 8; note = `距最高价 ${dd.toFixed(0)}%，健康回调区`; }
      else if (dd > -90) { s = 5; note = `距最高价 ${dd.toFixed(0)}%，深度回撤`; }
      else { s = 2; note = `距最高价 ${dd.toFixed(0)}%，接近归零`; flag = 'danger'; }
      return { key: 'recovery', label: '回撤与位置', score: s, max: 8, note, flag };
    }

    // 无历史：用 24h 区间位置代理
    const hi = coin.high24h || 0;
    const lo = coin.low24h || 0;
    if (hi > lo && price > 0) {
      const pos = clamp((price - lo) / (hi - lo), 0, 1);
      let s, note;
      if (pos >= 0.75) { s = 6; note = `位于 24h 区间高位 ${Math.round(pos * 100)}%，短线偏强`; }
      else if (pos >= 0.4) { s = 5; note = `位于 24h 区间中部 ${Math.round(pos * 100)}%`; }
      else if (pos >= 0.15) { s = 3; note = `位于 24h 区间低位 ${Math.round(pos * 100)}%`; }
      else { s = 1; note = `贴近 24h 低点，短线弱势`; }
      return { key: 'recovery', label: '回撤与位置', score: s, max: 8, note, missing: true };
    }

    return { key: 'recovery', label: '回撤与位置', score: 4, max: 8, note: '缺价格区间数据，按中性计', missing: true };
  }

  /* ---------------- 综合 ---------------- */

  const REL_FACTORS = [fExchange, fOfficial, fLiquidity, fPersistence, fConsistency, fStability];
  const POT_FACTORS = [fAttention, fMomentum, fRoom, fFreshness, fNarrative, fRecovery];

  function grade(total, rel) {
    if (total >= 68 && rel >= 55) return 'A';
    if (total >= 55 && rel >= 42) return 'B';
    if (total >= 42) return 'C';
    return 'D';
  }

  function tagline(rel, pot) {
    if (rel >= 60 && pot >= 60) return { label: '稳健成长', tone: 'good', note: '基本面与动能同时达标' };
    if (rel >= 55 && pot >= 68) return { label: '高弹性', tone: 'good', note: '可靠性过关且上涨空间大' };
    if (pot >= 68 && rel < 42) return { label: '高风险投机', tone: 'warn', note: '弹性大但缺乏可靠性支撑' };
    if (rel >= 55) return { label: '相对稳健', tone: 'mid', note: '可靠性较好，动能一般' };
    if (rel < 30) return { label: '建议规避', tone: 'danger', note: '多项可靠性指标不达标' };
    return { label: '观察', tone: 'mid', note: '证据不足，继续跟踪' };
  }

  /**
   * 计算单个币的评分。
   * @param {object} coin 需要字段：exchanges, binanceTags, quoteVolume, marketCap,
   *                      change24h, price, firstPrice, ageDays, histMax, cgId, snapDays,
   *                      qvPercentile（无市值时按池内百分位替代换手率）
   */
  function compute(coin) {
    const relF = REL_FACTORS.map(f => f(coin));
    const potF = POT_FACTORS.map(f => f(coin));
    const rel = clamp(relF.reduce((a, f) => a + f.score, 0), 0, 100);
    const pot = clamp(potF.reduce((a, f) => a + f.score, 0), 0, 100);
    const total = rel * 0.55 + pot * 0.45;
    const g = grade(total, rel);
    const t = tagline(rel, pot);
    const flags = [...relF, ...potF].filter(f => f.flag).map(f => f.flag);
    return {
      reliability: round1(rel),
      potential: round1(pot),
      total: round1(total),
      grade: g,
      tag: t,
      hasDanger: flags.includes('danger'),
      hasWarn: flags.includes('warn'),
      missingCount: [...relF, ...potF].filter(f => f.missing).length,
      relFactors: relF,
      potFactors: potF,
      modelVersion: MODEL_VERSION,
    };
  }

  function computeAll(list) {
    return list.map(c => ({ ...c, score: compute(c) }));
  }

  /* ---------------- 评分理由 ---------------- */

  /**
   * explain() 把一次评分结果翻译成人能读的理由：
   *   head        一句话说清"分是从哪来的"
   *   whyGrade    为什么恰好是这一档，不是上一档
   *   strengths   得分率 ≥70% 的因子，按得分率排
   *   weaknesses  按"丢掉的绝对分"排，满分高的因子权重大，理应优先解释
   *   next        升到上一档还差多少
   *   risks       带 danger/warn 标记的因子，单独拎出来
   *   missing     缺数据按中性计分的因子，必须声明，否则读者会误判可信度
   */
  const GATE = { A: [68, 55], B: [55, 42], C: [42, 0], D: [0, 0] };
  const NEXT_GRADE = { D: 'C', C: 'B', B: 'A', A: null };

  const WHY_GRADE = {
    A: '综合分与可靠性同时越过 A 级线（≥68 / ≥55），两个维度都有实质证据。',
    B: '综合分够 B 级但够不到 A 级，有一项门槛没过 — 可以看，不宜当核心仓位。',
    C: '只够 C 级线（综合 ≥42），可靠性证据不足 — 适合小仓位观察。',
    D: '综合分低于 42，可靠性证据不成立 — 先别碰，等它自己证明。',
  };

  function explain(s) {
    if (!s) return null;
    const all = [...s.relFactors, ...s.potFactors];

    const strengths = all
      .filter(f => f.max > 0 && !f.missing && f.score / f.max >= 0.7)
      .sort((a, b) => (b.score / b.max) - (a.score / a.max) || b.score - a.score)
      .slice(0, 3)
      .map(f => ({
        label: f.label, score: round1(f.score), max: f.max,
        rate: f.score / f.max, note: f.note, missing: false, flag: f.flag || null, loss: 0,
      }));

    const weaknesses = all
      .filter(f => f.max > 0 && round1(f.max - f.score) >= 1)
      .sort((a, b) => round1(b.max - b.score) - round1(a.max - a.score) || b.max - a.max)
      .slice(0, 3)
      .map(f => ({
        label: f.label, score: round1(f.score), max: f.max,
        loss: round1(f.max - f.score), note: f.note,
        missing: !!f.missing, flag: f.flag || null,
      }));

    const risks = all
      .filter(f => f.flag)
      .map(f => ({ label: f.label, flag: f.flag, note: f.note }));

    const missing = all
      .filter(f => f.missing)
      .map(f => ({ label: f.label, score: round1(f.score), max: f.max, note: f.note }));

    const nextG = NEXT_GRADE[s.grade];
    let next = null;
    if (nextG) {
      const gate = GATE[nextG];
      const gapTotal = round1(Math.max(0, gate[0] - s.total));
      const gapRel = round1(Math.max(0, gate[1] - s.reliability));
      const parts = [];
      if (gapTotal > 0) parts.push('综合分 +' + gapTotal.toFixed(1));
      if (gapRel > 0) parts.push('可靠性 +' + gapRel.toFixed(1));
      next = {
        grade: nextG, needTotal: gate[0], needRel: gate[1], gapTotal, gapRel,
        text: parts.length ? parts.join('、') : '门槛已满足',
      };
    }

    const sName = strengths.slice(0, 2).map(f => '「' + f.label + '」');
    const wName = weaknesses.slice(0, 2).map(f => '「' + f.label + '」');
    let head;
    if (sName.length && wName.length) {
      head = sName.join('、') + '撑起这个分数，' + wName.join('、') + '丢分最多。';
    } else if (sName.length) {
      head = sName.join('、') + '全部达标，没有明显短板。';
    } else if (wName.length) {
      head = '没有一项因子进入优秀区间，' + wName.join('、') + '丢分最重。';
    } else {
      head = '各因子都落在中性区间，既没有突出强项，也没有明显短板。';
    }

    return {
      head,
      whyGrade: WHY_GRADE[s.grade] || '',
      strengths, weaknesses, risks, missing, next,
      weightRel: 55, weightPot: 45,
      relWeighted: round1(s.reliability * 0.55),
      potWeighted: round1(s.potential * 0.45),
    };
  }

  /** 评分分档统计，用于校验模型区分度 */
  function distribution(scored) {
    const buckets = { A: [], B: [], C: [], D: [] };
    for (const c of scored) {
      if (c.score && buckets[c.score.grade]) buckets[c.score.grade].push(c);
    }
    const out = {};
    for (const [k, arr] of Object.entries(buckets)) {
      const qv = arr.map(c => c.quoteVolume || 0);
      const mc = arr.map(c => c.marketCap || 0).filter(x => x > 0);
      out[k] = {
        count: arr.length,
        medianQv: qv.length ? median(qv) : 0,
        medianMcap: mc.length ? median(mc) : 0,
        dangerRate: arr.length ? arr.filter(c => c.score.hasDanger).length / arr.length : 0,
        cgCoverage: arr.length ? arr.filter(c => (c.marketCap || 0) > 0).length / arr.length : 0,
      };
    }
    return out;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  return { compute, computeAll, explain, distribution, MODEL_VERSION, median };
})();

if (typeof window !== 'undefined') window.Score = Score;

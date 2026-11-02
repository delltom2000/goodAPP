/* ============================================================
   render.js — 渲染层
   行级复用，避免整表重建；实时更新只改文本节点
   ============================================================ */

'use strict';

const Render = (() => {

  /* ---------------- DOM 缓存 ---------------- */
  const $ = id => document.getElementById(id);
  const el = {
    kpiGrid: $('kpiGrid'),
    breadthBar: $('breadthBar'),
    bbUp: $('bbUp'), bbFlat: $('bbFlat'), bbDown: $('bbDown'),
    breadthNums: $('breadthNums'),
    distChart: $('distChart'),
    flowUp: $('flowUp'), flowDown: $('flowDown'),
    flowStats: $('flowStats'), meterCursor: $('meterCursor'),
    leaderList: $('leaderList'),
    leaderSeg: $('leaderSeg'),
    signalGrid: $('signalGrid'), signalCount: $('signalCount'),
    coinBody: $('coinBody'),
    coinTable: $('coinTable'),
    tableWrap: $('tableWrap'),
    tableEmpty: $('tableEmpty'),
    poolInfo: $('poolInfo'),
    footStats: $('footStats'),
    loadMoreBtn: $('loadMoreBtn'),
    searchInput: $('searchInput'),
    filterSelect: $('filterSelect'),
    conn: $('conn'), connText: $('connText'),
    clock: $('clock'),
    drawer: $('drawer'), drawerMask: $('drawerMask'),
    dImg: $('dImg'), dName: $('dName'), dSymbol: $('dSymbol'),
    dPrice: $('dPrice'), dChange: $('dChange'), dStats: $('dStats'), dChart: $('dChart'),
    dSources: $('dSources'),
    dWatch: $('dWatch'), drawerClose: $('drawerClose'),
    toast: $('toast'),
  };

  /* ---------------- 表格状态 ---------------- */
  const view = {
    sortKey: 'rank',
    sortDir: 'asc',
    filter: 'all',
    query: '',
    limit: CFG.MAX_ROWS_RENDERED,
    leaderMode: 'gainers',
    // 自选库统一由 Watch 管理（支持多目录），此处只做"是否已收藏"的快速判断
    watch: new Set((typeof Watch !== 'undefined') ? Watch.allBases() : lsGet(CFG.WATCH_KEY, [])),
    rows: new Map(),          // base -> { tr, cells }
    lastList: [],
    visibleBases: [],
  };

  /* ---------------- 颜色工具 ---------------- */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  let palette = { up: '#f6465d', down: '#0ecb81' };
  function refreshPalette() {
    palette.up = cssVar('--up') || '#f6465d';
    palette.down = cssVar('--down') || '#0ecb81';
  }

  /* ---------------- 头像 ---------------- */
  const AVATAR_COLORS = ['#f7931a','#627eea','#00ffa3','#f3ba2f','#9945ff','#e84142','#2775ca','#8247e5','#ff007a','#2a5ada'];

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function letterAvatar(base) {
    const c1 = AVATAR_COLORS[hashStr(base) % AVATAR_COLORS.length];
    const ch = base.slice(0, 1).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c1}b0"/>
      </linearGradient></defs>
      <rect width="40" height="40" rx="20" fill="url(#g)"/>
      <text x="20" y="26.5" font-family="system-ui,-apple-system,sans-serif" font-size="18" font-weight="800"
        fill="#ffffff" stroke="rgba(0,0,0,.28)" stroke-width="0.9" paint-order="stroke"
        text-anchor="middle">${ch}</text>
    </svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /** 三级回退：CoinGecko → Binance CDN → 字母头像 */
  function attachAvatar(img, coin) {
    img.dataset.stage = '0';
    img.src = coin.image || imgSrcBinance(coin.base);
    img.onerror = function () {
      const stage = img.dataset.stage;
      if (stage === '0') {
        img.dataset.stage = '1';
        img.src = imgSrcBinance(coin.base);
        return;
      }
      img.onerror = null;
      img.dataset.stage = '2';
      img.src = letterAvatar(coin.base);
    };
  }

  function imgSrcBinance(base) {
    return CFG.BINANCE_LOGO.replace('{BASE}', base);
  }

  /** HTML 转义（币种名来自外部 API） */
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------- Canvas 初始化 ---------------- */
  function setupCanvas(canvas, cssHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(rect.width || canvas.parentElement.clientWidth || 400, 100);
    const h = cssHeight || canvas.getAttribute('height') * 1 || 150;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* ============================================================
     KPI 卡片
     ============================================================ */
  function renderKPI(m, state) {
    const fmtSigned = v => isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '--';

    const cards = [
      {
        label: '池内总成交额 · 24h',
        value: fmtMoney(m.totalVolume),
        sub: `前 10 占 ${(m.top10Vol / m.totalVolume * 100).toFixed(1)}%`,
        cls: '',
      },
      {
        label: '涨跌家数',
        value: `${m.up} <small>/ ${m.down}</small>`,
        sub: `平盘 ${m.flat} · 上涨占比 ${(m.upRatio * 100).toFixed(1)}%`,
        cls: m.up >= m.down ? 'up' : 'down',
        raw: true,
      },
      {
        label: '成交额加权涨跌',
        value: fmtSigned(m.weightedChg),
        sub: `等权 ${fmtSigned(m.avgChg)} · 中位 ${fmtSigned(m.medChg)}`,
        cls: dirClass(m.weightedChg),
      },
      {
        label: '市场情绪',
        value: m.sentiment.toFixed(0) + '<small>/100</small>',
        sub: sentimentLabel(m.sentiment),
        cls: m.sentiment >= 50 ? 'up' : 'down',
        raw: true,
      },
      {
        label: '净资金流（估算）',
        value: (m.netFlow >= 0 ? '+' : '-') + fmtMoney(Math.abs(m.netFlow)),
        sub: `多头成交占比 ${(m.bullishShare * 100).toFixed(1)}%`,
        cls: dirClass(m.netFlow),
      },
      {
        label: '平均振幅',
        value: m.avgAmp.toFixed(2) + '<small>%</small>',
        sub: `中位 ${m.medAmp.toFixed(2)}%`,
        cls: '',
        raw: true,
      },
      {
        label: '池内总市值',
        value: fmtMoney(m.totalMarketCap),
        sub: `覆盖 ${m.mcCovered}/${m.n} 个币`,
        cls: '',
      },
      {
        label: '中位换手率',
        value: (m.medianTurnover || 0).toFixed(2) + '<small>%</small>',
        sub: `日成交额 / 市值`,
        cls: '',
        raw: true,
      },
    ];

    el.kpiGrid.innerHTML = cards.map(c => `
      <div class="kpi">
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value ${c.cls}">${c.value}</div>
        <div class="kpi-sub">${c.sub}</div>
      </div>
    `).join('');
  }

  function sentimentLabel(s) {
    if (s >= 75) return '极度贪婪 · 普涨格局';
    if (s >= 60) return '偏暖 · 多头占优';
    if (s >= 45) return '中性 · 多空均衡';
    if (s >= 30) return '偏冷 · 空头占优';
    return '极度恐慌 · 普跌格局';
  }

  /* ============================================================
     市场宽度 + 涨跌分布
     ============================================================ */
  function renderBreadth(m) {
    const total = m.up + m.down + m.flat || 1;
    const pu = m.up / total * 100;
    const pd = m.down / total * 100;
    const pf = m.flat / total * 100;

    el.bbUp.style.width = pu + '%';
    el.bbDown.style.width = pd + '%';
    el.bbFlat.style.width = pf + '%';

    el.bbUp.textContent = pu > 9 ? m.up : '';
    el.bbDown.textContent = pd > 9 ? m.down : '';
    el.bbFlat.textContent = pf > 9 ? m.flat : '';

    el.breadthNums.innerHTML = `
      <span>上涨 <b class="up">${m.up}</b></span>
      <span>平盘 <b class="flat">${m.flat}</b></span>
      <span>下跌 <b class="down">${m.down}</b></span>
      <span>上涨占比 <b>${(m.upRatio * 100).toFixed(1)}%</b></span>
    `;

    drawHistogram(m.histogram);
  }

  function drawHistogram(hist) {
    const { ctx, w, h } = setupCanvas(el.distChart, 150);
    ctx.clearRect(0, 0, w, h);

    const padL = 6, padR = 6, padT = 14, padB = 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxCount = Math.max(...hist.map(b => b.count), 1);
    const barW = plotW / hist.length;
    const gap = Math.max(1.5, barW * 0.18);

    // 网格线
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + plotH * (i / 3);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    // 柱体
    hist.forEach((b, i) => {
      const x = padL + i * barW;
      const bh = (b.count / maxCount) * plotH;
      const y = padT + plotH - bh;
      const isUp = b.mid > 0;
      const isFlat = Math.abs(b.mid) < 1.5;

      const color = isFlat ? '#3d4855' : (isUp ? palette.up : palette.down);
      ctx.fillStyle = color;
      ctx.globalAlpha = b.count === 0 ? 0 : 0.85;

      const bx = x + gap / 2;
      const bw = Math.max(barW - gap, 1);
      const r = Math.min(3, bw / 2);

      ctx.beginPath();
      ctx.moveTo(bx, padT + plotH);
      ctx.lineTo(bx, y + r);
      ctx.quadraticCurveTo(bx, y, bx + r, y);
      ctx.lineTo(bx + bw - r, y);
      ctx.quadraticCurveTo(bx + bw, y, bx + bw, y + r);
      ctx.lineTo(bx + bw, padT + plotH);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // 数值标注（柱子足够高时）
      if (b.count > 0 && bh > 13) {
        ctx.fillStyle = '#e9ecf1';
        ctx.font = '600 9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(b.count, x + barW / 2, y - 4);
      }

      // x 轴标签（隔一个显示）
      if (i % 2 === 0 || hist.length <= 8) {
        ctx.fillStyle = 'rgba(152,163,179,.75)';
        ctx.font = '8.5px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(b.label.replace('~', '/'), x + barW / 2, h - 7);
      }
    });

    // 零轴标记
    const zeroIdx = hist.findIndex(b => b.mid > 0);
    if (zeroIdx > 0) {
      const zx = padL + zeroIdx * barW;
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(zx, padT - 4);
      ctx.lineTo(zx, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* ============================================================
     资金流向
     ============================================================ */
  function renderFlow(m) {
    const bull = m.bullishShare * 100;
    const bear = 100 - bull;

    el.flowUp.style.flexBasis = Math.max(bull, 0) + '%';
    el.flowDown.style.flexBasis = Math.max(bear, 0) + '%';
    el.flowUp.querySelector('span').textContent = bull.toFixed(1) + '%';
    el.flowDown.querySelector('span').textContent = bear.toFixed(1) + '%';

    el.flowStats.innerHTML = `
      <div class="flow-stat">
        <span class="fs-label">上涨币种成交额</span>
        <span class="fs-value up">${fmtMoney(m.upVolume)}</span>
      </div>
      <div class="flow-stat">
        <span class="fs-label">下跌币种成交额</span>
        <span class="fs-value down">${fmtMoney(m.downVolume)}</span>
      </div>
      <div class="flow-stat">
        <span class="fs-label">净流入（估算）</span>
        <span class="fs-value ${dirClass(m.netFlow)}">${(m.netFlow >= 0 ? '+' : '-') + fmtMoney(Math.abs(m.netFlow))}</span>
      </div>
      <div class="flow-stat">
        <span class="fs-label">成交额集中度</span>
        <span class="fs-value">${(m.top10Vol / m.totalVolume * 100).toFixed(1)}<small style="font-size:10px;color:var(--text-dim)">%</small></span>
      </div>
    `;

    el.meterCursor.style.left = Math.max(2, Math.min(98, bull)) + '%';
  }

  /* ============================================================
     榜单
     ============================================================ */
  function renderLeader(m) {
    const rows = view.leaderMode === 'gainers' ? m.gainers
               : view.leaderMode === 'losers' ? m.losers
               : m.volumeLeaders;

    if (!rows || rows.length === 0) {
      el.leaderList.innerHTML = '<div class="leader-empty">暂无数据</div>';
      return;
    }

    el.leaderList.innerHTML = rows.map((c, i) => {
      const fullName = (c.name && c.name.toUpperCase() !== c.base) ? escHtml(c.name) : '';
      return `
      <div class="leader-row" data-base="${escHtml(c.base)}">
        <span class="lr-idx">${i + 1}</span>
        <span class="lr-sym">
          <img alt="" loading="lazy" src="${escHtml(c.image || imgSrcBinance(c.base))}" onerror="this.onerror=null;this.src='${letterAvatar(c.base)}'">
          <b>${escHtml(c.base)}</b>${fullName ? `<em>${fullName}</em>` : ''}
        </span>
        <span class="lr-price">${fmtPrice(c.price)}</span>
        <span class="lr-chg ${dirClass(c.changePct)}">${fmtPct(c.changePct)}</span>
      </div>`;
    }).join('');
  }

  /* ============================================================
     异动雷达
     ============================================================ */
  function renderSignals(m) {
    el.signalCount.textContent = m.signals.length;

    if (m.signals.length === 0) {
      el.signalGrid.innerHTML = '<div class="signal-empty">当前无显著异动</div>';
      return;
    }

    el.signalGrid.innerHTML = m.signals.slice(0, 22).map(s => {
      const t = Analytics.SIGNAL_TYPES[s.type];
      return `
        <div class="signal-item" data-base="${escHtml(s.coin.base)}">
          <span class="sig-tag ${t.color}">${t.label}</span>
          <span class="sig-main">
            <b>${escHtml(s.coin.base)}</b>
            <span>${s.note} · 额 ${fmtMoney(s.coin.quoteVolume)}</span>
          </span>
          <span class="sig-val ${dirClass(s.coin.changePct)}">${fmtPct(s.coin.changePct)}</span>
        </div>
      `;
    }).join('');
  }

  /* ============================================================
     主表格
     ============================================================ */
  function filterList(list) {
    let out = list;
    const q = view.query.trim().toUpperCase();

    if (q) {
      out = out.filter(c =>
        c.base.includes(q) ||
        (c.name && c.name.toUpperCase().includes(q))
      );
    }

    switch (view.filter) {
      case 'gainers': out = out.filter(c => c.changePct > 0); break;
      case 'losers':  out = out.filter(c => c.changePct < 0); break;
      case 'hot':     out = out.filter(c => c.turnover !== null && c.turnover !== undefined && c.turnover >= 15); break;
      case 'volatile':out = out.filter(c => c.amplitude >= 12); break;
      case 'watch':   out = out.filter(c => view.watch.has(c.base)); break;
    }

    const key = view.sortKey;
    if (key !== 'rank') {
      out = out.slice().sort((a, b) => {
        let av = a[key], bv = b[key];
        if (av === null || av === undefined) av = -Infinity;
        if (bv === null || bv === undefined) bv = -Infinity;
        if (typeof av === 'string') return view.sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        return view.sortDir === 'asc' ? av - bv : bv - av;
      });
    } else {
      out = out.slice().sort((a, b) => view.sortDir === 'asc' ? a.rank - b.rank : b.rank - a.rank);
    }

    return out;
  }

  function makeCell(tag, cls) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    return d;
  }

  function makeRow(coin) {
    const tr = document.createElement('tr');
    tr.dataset.base = coin.base;

    const tdRank = makeCell('td', 'c-rank');
    const tdName = makeCell('td');
    const nameWrap = document.createElement('div');
    nameWrap.className = 'c-name';
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.width = 22; img.height = 22;
    attachAvatar(img, coin);
    const txt = document.createElement('div');
    txt.className = 'c-name-txt';
    const sym = makeCell('span', 'c-sym');
    const full = makeCell('span', 'c-full');
    txt.append(sym, full);
    nameWrap.append(img, txt);
    tdName.append(nameWrap);

    const tdPrice = makeCell('td', 'num c-price');
    const tdChg = makeCell('td', 'num');
    const pill = makeCell('span', 'chg-pill');
    tdChg.append(pill);
    const tdAmp = makeCell('td', 'num c-amp');
    const tdVol = makeCell('td', 'num c-vol');
    const tdMc = makeCell('td', 'num c-mc');
    const tdTurn = makeCell('td', 'num c-turn');
    const tdPulse = makeCell('td', 'c-pulse');
    const pulseWrap = document.createElement('div');
    pulseWrap.className = 'pulse-wrap';
    const pulseFill = makeCell('div', 'pulse-fill');
    const pulseMark = makeCell('div', 'pulse-mark');
    pulseWrap.append(pulseFill, pulseMark);
    tdPulse.append(pulseWrap);

    tr.append(tdRank, tdName, tdPrice, tdChg, tdAmp, tdVol, tdMc, tdTurn, tdPulse);

    return {
      tr,
      cells: { rank: tdRank, sym, full, img, price: tdPrice, pill, amp: tdAmp, vol: tdVol, mc: tdMc, turn: tdTurn, fill: pulseFill, mark: pulseMark },
      base: coin.base,
    };
  }

  function updateRow(rec, coin, isNew) {
    const c = rec.cells;
    c.rank.textContent = coin.rank;
    c.sym.innerHTML = coin.base + (view.watch.has(coin.base) ? '<span class="star">★</span>' : '');
    c.full.textContent = coin.name && coin.name !== coin.base ? coin.name : '';
    c.price.textContent = fmtPrice(coin.price);
    c.price.className = 'num c-price ' + dirClass(coin.changePct);

    c.pill.textContent = fmtPct(coin.changePct);
    c.pill.className = 'chg-pill ' + dirClass(coin.changePct);

    c.amp.textContent = coin.amplitude.toFixed(2) + '%';
    c.vol.textContent = fmtMoney(coin.quoteVolume);
    c.mc.textContent = coin.marketCap ? fmtMoney(coin.marketCap) : '--';
    c.turn.textContent = (coin.turnover !== null && coin.turnover !== undefined)
      ? coin.turnover.toFixed(2) + '%' : '--';

    const pos = Math.max(0, Math.min(100, coin.rangePos || 50));
    c.fill.style.width = pos + '%';
    c.fill.style.background = coin.changePct >= 0 ? palette.up : palette.down;
    c.mark.style.left = `calc(${pos}% - 1px)`;
    c.mark.style.background = coin.changePct >= 0 ? palette.up : palette.down;

    if (view.watch.has(coin.base)) rec.tr.classList.add('watched');
    else rec.tr.classList.remove('watched');

    if (isNew) attachAvatar(c.img, coin);
  }

  function renderTable(list, opts = {}) {
    const filtered = filterList(list);
    const shown = filtered.slice(0, view.limit);

    // 回收不可见的行记录
    const keep = new Set(shown.map(c => c.base));
    for (const [base, rec] of view.rows) {
      if (!keep.has(base)) {
        rec.tr.remove();
        view.rows.delete(base);
      }
    }

    const frag = document.createDocumentFragment();
    const order = [];

    for (const coin of shown) {
      let rec = view.rows.get(coin.base);
      const isNew = !rec;
      if (!rec) {
        rec = makeRow(coin);
        view.rows.set(coin.base, rec);
      }
      updateRow(rec, coin, isNew);
      frag.appendChild(rec.tr);      // 重新 append 即完成排序
      order.push(coin.base);
    }

    el.coinBody.appendChild(frag);

    el.tableEmpty.hidden = filtered.length > 0;
    el.loadMoreBtn.hidden = filtered.length <= view.limit;
    if (filtered.length > view.limit) {
      el.loadMoreBtn.textContent = `显示更多（剩余 ${filtered.length - view.limit} 个）`;
    }

    el.poolInfo.textContent = `${list.length} 个币 · 当前显示 ${shown.length} / ${filtered.length}`;

    let totalVol = 0, upCount = 0;
    for (const c of filtered) { totalVol += c.quoteVolume; if (c.changePct > 0) upCount++; }
    el.footStats.textContent =
      `筛选结果 ${filtered.length} 个 · 合计成交额 ${fmtMoney(totalVol)} · 上涨 ${upCount} / 下跌 ${filtered.length - upCount}`;

    view.lastList = list;
    view.visibleBases = order;
  }

  /** 实时更新可见行的价格与涨跌（不重排） */
  function updatePrices(changed) {
    for (const base of changed) {
      const rec = view.rows.get(base);
      if (!rec) continue;
      const coin = DataFeed.getCoin(base);
      if (!coin) continue;

      const prev = parseFloat(rec.cells.price.dataset.v || '0');
      const now = coin.price;

      rec.cells.price.textContent = fmtPrice(now);
      rec.cells.price.className = 'num c-price ' + dirClass(coin.changePct);

      rec.cells.pill.textContent = fmtPct(coin.changePct);
      rec.cells.pill.className = 'chg-pill ' + dirClass(coin.changePct);

      rec.cells.vol.textContent = fmtMoney(coin.quoteVolume);
      rec.cells.amp.textContent = coin.amplitude.toFixed(2) + '%';
      if (coin.marketCap) rec.cells.mc.textContent = fmtMoney(coin.marketCap);
      rec.cells.turn.textContent = (coin.turnover !== null && coin.turnover !== undefined)
        ? coin.turnover.toFixed(2) + '%' : '--';

      const pos = Math.max(0, Math.min(100, coin.rangePos || 50));
      rec.cells.fill.style.width = pos + '%';
      rec.cells.mark.style.left = `calc(${pos}% - 1px)`;

      // 价格闪烁
      if (prev && Math.abs(now - prev) > 1e-12) {
        const cls = now > prev ? 'flash-up' : 'flash-down';
        const cell = rec.cells.price;
        cell.classList.remove('flash-up', 'flash-down');
        void cell.offsetWidth;
        cell.classList.add(cls);
      }
      rec.cells.price.dataset.v = now;
    }
  }

  /* ============================================================
     详情抽屉
     ============================================================ */
  let drawerBase = null;

  function openDrawer(base) {
    const coin = DataFeed.getCoin(base);
    if (!coin) return;
    drawerBase = base;

    el.dImg.src = coin.image || imgSrcBinance(base);
    el.dImg.onerror = function () { this.onerror = null; this.src = letterAvatar(base); };
    el.dName.textContent = coin.name || base;
    el.dSymbol.textContent = base + ' / USDT';
    el.dPrice.textContent = fmtPrice(coin.price);
    el.dChange.textContent = fmtPct(coin.changePct);
    el.dChange.className = 'chg-pill ' + dirClass(coin.changePct);

    const mc = coin.marketCap ? fmtMoney(coin.marketCap) : '--';
    const turn = (coin.turnover !== null && coin.turnover !== undefined) ? coin.turnover.toFixed(2) + '%' : '--';
    el.dStats.innerHTML = `
      <div class="d-stat"><span>24h 成交额</span><b>${fmtMoney(coin.quoteVolume)}</b></div>
      <div class="d-stat"><span>市值</span><b>${mc}</b></div>
      <div class="d-stat"><span>24h 最高</span><b>${fmtPrice(coin.high)}</b></div>
      <div class="d-stat"><span>24h 最低</span><b>${fmtPrice(coin.low)}</b></div>
      <div class="d-stat"><span>24h 振幅</span><b>${coin.amplitude.toFixed(2)}%</b></div>
      <div class="d-stat"><span>日换手率</span><b>${turn}</b></div>
      <div class="d-stat"><span>成交额排名</span><b>#${coin.rank}</b></div>
      <div class="d-stat"><span>覆盖交易所</span><b>${Object.keys(coin.src).map(id => id.toUpperCase()).join(' / ') || '--'}</b></div>
    `;

    el.dWatch.textContent = view.watch.has(base) ? '移出自选' : '加入自选';
    el.dWatch.dataset.base = base;

    renderSources(coin);

    el.drawer.hidden = false;
    el.drawerMask.hidden = false;

    loadDrawerChart(coin);
  }

  /* 各交易所成交额构成：体现「跨所聚合」的数据来源 */
  const EX_COLOR = { binance: '#f0b90b', okx: '#4fa8ff', bybit: '#ff8f3f', gate: '#8b5cf6' };

  function renderSources(coin) {
    const entries = Object.entries(coin.src || {})
      .map(([id, v]) => ({ id, q: v.q || 0 }))
      .filter(e => e.q > 0)
      .sort((a, b) => b.q - a.q);

    if (entries.length === 0) { el.dSources.innerHTML = ''; return; }

    const total = entries.reduce((s, e) => s + e.q, 0);
    const labelOf = id => {
      const ex = EXCHANGES.find(x => x.id === id);
      return ex ? ex.label : id.toUpperCase();
    };

    el.dSources.innerHTML = `
      <div class="ds-title">成交额来源分布</div>
      <div class="src-bar">
        ${entries.map(e => `<div class="src-seg" style="width:${(e.q / total * 100).toFixed(2)}%;background:${EX_COLOR[e.id] || '#4a5563'}" title="${labelOf(e.id)} ${(e.q / total * 100).toFixed(1)}%"></div>`).join('')}
      </div>
      <div class="src-legend">
        ${entries.map(e => `
          <span class="src-item">
            <i style="background:${EX_COLOR[e.id] || '#4a5563'}"></i>
            ${labelOf(e.id)} <b>${(e.q / total * 100).toFixed(1)}%</b>
          </span>`).join('')}
      </div>
    `;
  }

  function closeDrawer() {
    el.drawer.hidden = true;
    el.drawerMask.hidden = true;
    drawerBase = null;
  }

  async function loadDrawerChart(coin) {
    const { ctx, w, h } = setupCanvas(el.dChart, 180);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(152,163,179,.7)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('加载走势…', w / 2, h / 2);

    try {
      const candles = await DataFeed.fetchCandles(coin);
      if (!candles || candles.length < 2) throw new Error('empty');
      if (drawerBase !== coin.base) return;   // 期间切换了币种
      drawLineChart(candles, ctx, w, h, coin);
    } catch (e) {
      console.warn('[drawer-chart]', e && e.message);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(152,163,179,.7)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('走势数据暂不可用', w / 2, h / 2);
      if (window.__pushErr) window.__pushErr('chart: ' + (e && e.message));
    }
  }

  function drawLineChart(points, ctx, w, h, coin) {
    ctx.clearRect(0, 0, w, h);

    const padL = 8, padR = 8, padT = 16, padB = 20;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const prices = points.map(p => p.c);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || 1;

    const x = i => padL + (i / (points.length - 1)) * plotW;
    const y = v => padT + plotH - ((v - min) / span) * plotH;

    const rising = prices[prices.length - 1] >= prices[0];
    const color = rising ? palette.up : palette.down;

    // 水平参考线
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const yy = padT + plotH * (i / 3);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
    }

    // 面积填充
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, hexA(color, 0.28));
    grad.addColorStop(1, hexA(color, 0));

    ctx.beginPath();
    ctx.moveTo(x(0), padT + plotH);
    points.forEach((p, i) => ctx.lineTo(x(i), y(p.c)));
    ctx.lineTo(x(points.length - 1), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 折线
    ctx.beginPath();
    points.forEach((p, i) => { i === 0 ? ctx.moveTo(x(i), y(p.c)) : ctx.lineTo(x(i), y(p.c)); });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 末端点
    const lx = x(points.length - 1), ly = y(prices[prices.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // 最高/最低标注
    ctx.fillStyle = 'rgba(152,163,179,.8)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(max), padL, padT - 5);
    ctx.textAlign = 'right';
    ctx.fillText(fmtPrice(min), w - padR, padT + plotH + 13);
  }

  function hexA(hex, a) {
    const n = hex.replace('#', '');
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /* ============================================================
     状态栏 / Toast
     ============================================================ */
  function renderStatus(state) {
    const st = state.wsState;
    const hasData = !!(state.list && state.list.length);
    const cachedAt = state.cachedAt || state.lastSnapshotAt;
    let label, mode;

    if (state.offline && hasData) {
      // 拉不到行情但本地有留存：把数据铺出来，并说清是几点的
      mode = 'offline';
      label = `离线数据 · ${fmtClock(cachedAt)}`;
    } else if (st === 'live') {
      mode = 'live';
      const at = state.lastMsgAt || state.lastSnapshotAt;
      label = at ? `实时推送 · ${fmtClock(at, true)}` : '实时推送';
    } else if (st === 'connecting') {
      mode = 'poll';
      label = '正在建立实时连接…';
    } else if (state.error && hasData) {
      mode = 'offline';
      label = `离线数据 · ${fmtClock(cachedAt)}`;
    } else if (state.error) {
      mode = 'error';
      label = state.error + '（重试中）';
    } else if (state.lastSnapshotAt) {
      mode = 'poll';
      label = `轮询模式 · ${fmtClock(state.lastSnapshotAt)}`;
    } else {
      mode = 'init';
      label = '正在接入行情…';
    }

    if (el.conn.dataset.state !== mode) el.conn.dataset.state = mode;
    if (el.connText.textContent !== label) el.connText.textContent = label;
    if (cachedAt) el.conn.title = `最新数据时间 ${fmtClock(cachedAt, true)}`;
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
  }

  /* ============================================================
     对外接口
     ============================================================ */
  return {
    el, view, palette,
    refreshPalette,
    renderKPI, renderBreadth, renderFlow, renderLeader, renderSignals,
    renderTable, updatePrices, renderStatus,
    openDrawer, closeDrawer, toast,
    letterAvatar, imgSrcBinance,
    getDrawerBase: () => drawerBase,
    redrawCharts: (m) => { if (m) drawHistogram(m.histogram); if (drawerBase) { const c = DataFeed.getCoin(drawerBase); if (c) loadDrawerChart(c); } },
  };

})();

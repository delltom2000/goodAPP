/* ==========================================================================
   NCRender — 新币雷达渲染层
   行级复用：只更新变化的单元格，不重建整表
   ========================================================================== */
const NCRender = (() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const el = {};
  function bind() {
    el.scopeCount = $('scopeCount');
    el.scopeNote = $('scopeNote');
    el.windowTabs = $('windowTabs');
    el.kpiGrid = $('kpiGrid');
    el.newBody = $('newBody');
    el.tableMeta = $('tableMeta');
    el.searchInput = $('searchInput');
    el.gradeFilter = $('gradeFilter');
    el.exFilter = $('exFilter');
    el.watchFilter = $('watchFilter');
    el.kbProjects = $('kbProjects');
    el.kbSnaps = $('kbSnaps');
    el.kbDays = $('kbDays');
    el.kbCover = $('kbCover');
    el.kbStatus = $('kbStatus');
    el.kbNote = $('kbNote');
    el.gradeBars = $('gradeBars');
    el.watchBody = $('watchBody');
    el.watchCapacity = $('watchCapacity');
    el.watchNavBtn = $('watchNavBtn');
    el.watchNavCount = $('watchNavCount');
    el.watchDrawer = $('watchDrawer');
    el.watchMask = $('watchMask');
    el.wdBody = $('wdBody');
    el.wdSub = $('wdSub');
    el.drawer = $('drawer');
    el.drawerMask = $('drawerMask');
    el.dName = $('dName');
    el.dSub = $('dSub');
    el.dIcon = $('dIcon');
    el.dPrice = $('dPrice');
    el.dChange = $('dChange');
    el.dRing = $('dRing');
    el.dRel = $('dRel');
    el.dPot = $('dPot');
    el.dTotal = $('dTotal');
    el.dGrade = $('dGrade');
    el.dRelSum = $('dRelSum');
    el.dPotSum = $('dPotSum');
    el.dRelFactors = $('dRelFactors');
    el.dPotFactors = $('dPotFactors');
    el.dReason = $('dReason');
    el.dExchanges = $('dExchanges');
    el.dKbInfo = $('dKbInfo');
    el.dKbDays = $('dKbDays');
    el.dWatch = $('dWatch');
    el.dDirSelect = $('dDirSelect');
    el.toast = $('toast');
    el.methodDrawer = $('methodDrawer');
    el.methodMask = $('methodMask');
    el.methodProof = $('methodProof');
  }

  /* ---------------- 格式化 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtPrice(v) {
    if (!(v > 0)) return '—';
    if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 1) return v.toFixed(2);
    if (v >= 0.01) return v.toFixed(4);
    if (v >= 0.0001) return v.toFixed(6);
    // 极小价用有效数字，避免一串 0
    const s = v.toPrecision(3);
    return Number(s) < 1e-7 ? v.toExponential(2) : s;
  }

  function fmtMoney(v) {
    if (!(v > 0)) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + v.toFixed(0);
  }

  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days == null || !isFinite(days)) return '—';
    if (days < 1) return Math.max(1, Math.round(days * 24)) + ' 小时';
    if (days < 90) return Math.round(days) + ' 天';
    if (days < 365) return (days / 30).toFixed(1) + ' 个月';
    return (days / 365).toFixed(1) + ' 年';
  }

  /** 名称与代号相同（或仅大小写不同）时不重复显示 */
  function nameSub(base, name) {
    const n = String(name || '').trim();
    if (!n) return '';
    if (n.toUpperCase() === String(base || '').toUpperCase()) return '';
    return n;
  }

  function dirClass(v) {
    if (v > 0.005) return 'up';
    if (v < -0.005) return 'down';
    return 'flat';
  }

  function avColors() {
    return ['#f0b90b', '#5b9dff', '#0ecb81', '#f6465d', '#a78bfa', '#2ee6c4', '#f79e1a', '#e879a6'];
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function letterAvatar(base) {
    const c1 = avColors()[hashStr(base) % avColors().length];
    const ch = base.slice(0, 1).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="24" fill="${c1}" opacity="0.22"/>
      <text x="24" y="31" font-family="system-ui,sans-serif" font-size="20" font-weight="700"
        fill="${c1}" text-anchor="middle">${ch}</text>
    </svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function iconSrc(base) {
    return 'https://bin.bnbstatic.com/static/assets/logos/' + encodeURIComponent(base) + '.png';
  }

  const EX_LABEL = { binance: 'BN', okx: 'OK', bybit: 'BB', gate: 'GT', bitget: 'BG' };
  const EX_ORDER = ['binance', 'okx', 'bybit', 'gate', 'bitget'];

  /* ---------------- 口径与 KPI ---------------- */

  function renderWindowTabs(windows, current, onChange) {
    if (!el.windowTabs) return;
    el.windowTabs.innerHTML = windows.map(w =>
      `<button role="tab" data-w="${w}" aria-selected="${w === current}">${w} 天</button>`
    ).join('');
    el.windowTabs.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const w = Number(b.dataset.w);
        if (w === current) return;
        onChange(w);
      });
    });
  }

  function renderScope(list, state) {
    if (!el.scopeCount) return;
    const n = list.length;
    const cap = state.maxPool || 500;
    const full = n >= cap;
    el.scopeCount.innerHTML = `窗口内符合条件的真实加密新项目 <b>${n}</b> 个` +
      (full ? `（已达上限 ${cap}）` : '');
    if (el.scopeNote) {
      el.scopeNote.textContent = n < cap
        ? `上限是 ${cap} 个，但 ${state.windowDays} 天内真实新项目只有这么多 — 已剔除杠杆代币、代币化股票、稳定币与合成资产`
        : '已达到池上限，更长窗口会纳入更多项目';
    }
  }

  function renderKPI(list, state) {
    if (!el.kpiGrid) return;
    const n = list.length;
    if (!n) {
      el.kpiGrid.innerHTML = '<div class="kpi"><span class="kpi-label">暂无数据</span><span class="kpi-value">—</span></div>';
      return;
    }

    const withScore = list.filter(c => c.score);
    const aCnt = withScore.filter(c => c.score.grade === 'A').length;
    const bCnt = withScore.filter(c => c.score.grade === 'B').length;
    const medQv = median(list.map(c => c.quoteVolume || 0));
    const medAge = median(list.map(c => c.ageDays || 0));
    const withMcap = list.filter(c => c.marketCap > 0).length;
    const medMcap = median(list.filter(c => c.marketCap > 0).map(c => c.marketCap));
    const fresh7 = list.filter(c => (c.ageDays || 999) <= 7).length;
    const onBn = list.filter(c => c.exchanges.binance).length;
    const dangerCnt = withScore.filter(c => c.score.hasDanger).length;

    const cards = [
      { label: '窗口内项目', value: String(n), sub: `上限 ${state.maxPool}`, tone: '' },
      { label: 'A / B 级', value: `${aCnt} / ${bCnt}`, sub: '通过可靠性门槛', tone: aCnt ? 'gold' : '' },
      { label: '中位成交额', value: fmtMoney(medQv), sub: '24 小时合计', tone: '' },
      { label: '中位上线时长', value: fmtAge(medAge), sub: `${fresh7} 个在 7 天内`, tone: '' },
      { label: '上了 Binance', value: String(onBn), sub: `${Math.round(onBn / n * 100)}% 覆盖率`, tone: '' },
      { label: '风险提示', value: String(dangerCnt), sub: '含警示信号', tone: dangerCnt ? 'warn' : '' },
    ];

    el.kpiGrid.innerHTML = cards.map(c => `
      <div class="kpi ${c.tone ? 'kpi-' + c.tone : ''}">
        <span class="kpi-label">${esc(c.label)}</span>
        <span class="kpi-value">${esc(c.value)}</span>
        <span class="kpi-sub">${esc(c.sub)}</span>
      </div>
    `).join('');

    // 市值覆盖写进知识库面板
    if (el.kbCover) el.kbCover.textContent = Math.round(withMcap / n * 100) + '%';
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ---------------- 表格 ---------------- */

  let rowCache = new Map();

  function renderTable(list, view) {
    if (!el.newBody) return;
    if (!list.length) {
      el.newBody.innerHTML = `<tr class="nc-empty-row"><td colspan="13">
        当前筛选条件下没有项目。<br>试试放宽上线窗口，或清空搜索与筛选。
      </td></tr>`;
      rowCache.clear();
      updateMeta(list, view);
      return;
    }

    const html = list.map((c, i) => rowHTML(c, i + 1, view)).join('');
    el.newBody.innerHTML = html;
    rowCache.clear();
    for (const c of list) rowCache.set(c.base, c.base);
    updateMeta(list, view);
  }

  function rowHTML(c, idx, view) {
    const s = c.score;
    const watched = Watch.has(c.base);
    const grade = s ? s.grade : 'D';
    const rel = s ? s.reliability : 0;
    const pot = s ? s.potential : 0;
    const total = s ? s.total : 0;

    const exChips = EX_ORDER
      .filter(ex => c.exchanges && c.exchanges[ex])
      .map(ex => `<span class="ex-chip ${ex}" title="${ex}">${EX_LABEL[ex]}</span>`)
      .join('') || '<span class="ex-chip">—</span>';

    const ageCls = (c.ageDays || 999) <= 14 ? 'fresh' : '';

    return `<tr data-base="${esc(c.base)}" tabindex="0">
      <td class="c-rank"><span class="rank-cell">${idx}</span></td>
      <td class="c-coin">
        <div class="coin-cell">
          <img alt="" loading="lazy" src="${iconSrc(c.base)}"
               onerror="this.onerror=null;this.src='${letterAvatar(c.base)}'">
          <div class="cc-text">
            <b>${esc(c.base)}${watched ? '<span class="tag-self">自选</span>' : ''}<span class="age-inline ${ageCls}">${fmtAge(c.ageDays)}</span></b>
            <em>${esc(nameSub(c.base, c.name))}</em>
          </div>
        </div>
      </td>
      <td class="c-age"><span class="age-cell ${ageCls}">${fmtAge(c.ageDays)}</span></td>
      <td class="num c-price">${fmtPrice(c.price)}</td>
      <td class="num c-chg ${dirClass(c.change24h)}">${fmtPct(c.change24h)}</td>
      <td class="num c-vol">${fmtMoney(c.quoteVolume)}</td>
      <td class="num c-mc">${c.marketCap > 0 ? fmtMoney(c.marketCap) : '<span class="flat">—</span>'}</td>
      <td class="c-ex"><div class="ex-cell">${exChips}</div></td>
      <td class="c-rel">${barCell(rel, 'rel')}</td>
      <td class="c-pot">${barCell(pot, 'pot')}</td>
      <td class="num c-total" style="font-weight:600">${total.toFixed(1)}</td>
      <td class="c-grade"><span class="grade-badge grade-${grade}">${grade}</span></td>
      <td class="center c-watch">
        <button class="watch-btn ${watched ? 'on' : ''}" data-watch="${esc(c.base)}"
          title="${watched ? '移出自选' : '加入自选'}" aria-label="自选">${watched ? '★' : '☆'}</button>
      </td>
    </tr>`;
  }

  function barCell(v, kind) {
    const pct = Math.max(0, Math.min(100, v));
    const color = kind === 'rel'
      ? 'linear-gradient(90deg, #5b9dff, #7bb3ff)'
      : 'linear-gradient(90deg, #f0b90b, #ffd257)';
    return `<div class="bar-cell">
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${color}"></span></span>
      <span class="bar-val">${v.toFixed(0)}</span>
    </div>`;
  }

  function updateMeta(list, view) {
    if (!el.tableMeta) return;
    const total = view && view.total != null ? view.total : list.length;
    el.tableMeta.textContent = `显示 ${list.length} / ${total} 个项目 · 按${
      view && view.sortLabel ? view.sortLabel : '综合分'
    }排序`;
  }

  /* ---------------- 知识库面板 ---------------- */

  function renderKB(kbStats, list) {
    if (!el.kbProjects) return;
    const st = kbStats || {};
    el.kbProjects.textContent = st.projects != null ? st.projects : 0;
    el.kbSnaps.textContent = st.snaps != null ? st.snaps : 0;

    const days = (() => {
      if (!list || !list.length) return 0;
      const mx = Math.max(...list.map(c => c.snapDays || 0));
      return mx;
    })();
    el.kbDays.textContent = days;

    if (el.kbStatus) {
      el.kbStatus.textContent = st.storage === 'memory' ? '临时（不持久）' : 'IndexedDB';
    }
    if (el.kbNote && days === 0) {
      el.kbNote.textContent = '首次运行，尚无历史快照。「交易持续性」和「回撤位置」按中性计分，明天再打开就会开始累积。';
    } else if (el.kbNote && days > 0) {
      el.kbNote.textContent = `已积累 ${days} 天快照。持续性因子开始生效，回撤位置改用知识库最高价计算。`;
    }

    // 分级分布条
    if (el.gradeBars && list && list.length) {
      const buckets = { A: 0, B: 0, C: 0, D: 0 };
      for (const c of list) if (c.score && buckets[c.score.grade] != null) buckets[c.score.grade]++;
      const maxN = Math.max(1, ...Object.values(buckets));
      const colors = { A: '#0ecb81', B: '#5b9dff', C: '#f0b90b', D: '#f6465d' };
      el.gradeBars.innerHTML = Object.entries(buckets).map(([g, n]) => `
        <div class="gb-row">
          <span class="gb-lab" style="color:${colors[g]}">${g}</span>
          <span class="gb-track"><span class="gb-fill" style="width:${n / maxN * 100}%;background:${colors[g]}"></span></span>
          <span class="gb-count">${n}</span>
        </div>
      `).join('');
    }
  }

  function renderMethodProof(dist) {
    if (!el.methodProof || !dist) return;
    const colors = { A: '#0ecb81', B: '#5b9dff', C: '#f0b90b', D: '#f6465d' };
    el.methodProof.innerHTML = Object.entries(dist).map(([g, d]) => `
      <div class="mp-row">
        <span class="mp-g" style="color:${colors[g]}">${g} (${d.count})</span>
        <span class="mp-k">中位成交额 <b>${fmtMoney(d.medianQv)}</b></span>
        <span class="mp-k">危险率 <b>${(d.dangerRate * 100).toFixed(0)}%</b></span>
      </div>
    `).join('');
  }

  /* ---------------- 自选库面板 ---------------- */

  const openDirs = new Set();

  function renderWatch() {
    if (!el.watchBody) return;
    const dirs = Watch.listDirs();
    const cap = Watch.capacity();
    if (el.watchCapacity) el.watchCapacity.textContent = `${cap.usedDirs} / ${cap.maxDirs} 目录`;
    renderWatchNav();

    if (!dirs.length) {
      el.watchBody.innerHTML = `<div class="watch-empty">
        还没有自选目录。点「＋ 新建」建立第一个，最多 10 个目录、每个 50 个币种。
      </div>`;
      return;
    }

    el.watchBody.innerHTML = dirs.map(d => {
      const open = openDirs.has(d.id);
      const full = d.count >= d.capacity;
      const coins = d.bases.length
        ? d.bases.map(b => `<span class="wd-coin">${esc(b)}<button data-rm="${esc(b)}" data-dir="${esc(d.id)}" title="移除">×</button></span>`).join('')
        : '<span class="wd-empty-coins">空目录</span>';
      return `<div class="wd-item ${open ? 'open' : ''}" data-dir="${esc(d.id)}">
        <div class="wd-head" data-toggle="${esc(d.id)}">
          <span class="wd-caret"></span>
          <span class="wd-name" title="${esc(d.name)}">${esc(d.name)}</span>
          <span class="wd-count ${full ? 'full' : ''}">${d.count}/${d.capacity}</span>
          <span class="wd-acts">
            <button data-rename="${esc(d.id)}" title="重命名">✎</button>
            <button data-del="${esc(d.id)}" class="danger" title="删除目录">×</button>
          </span>
        </div>
        <div class="wd-coins">${coins}</div>
      </div>`;
    }).join('');
  }

  /* ---------------- 自选股面板（顶部入口） ---------------- */

  function renderWatchNav() {
    const n = Watch.allBases().length;
    if (el.watchNavCount) el.watchNavCount.textContent = n;
    if (el.watchNavBtn) {
      el.watchNavBtn.dataset.empty = n ? 'false' : 'true';
      el.watchNavBtn.title = n ? `打开自选股（${n} 个币种）` : '还没有自选币，点行尾的 ☆ 加入';
    }
    return n;
  }

  function renderWatchDrawer() {
    if (!el.wdBody) return;
    const dirs = Watch.listDirs();
    const total = Watch.allBases().length;
    const list = (typeof NewFeed !== 'undefined' && NewFeed.getState().list) || [];
    const map = new Map();
    for (const c of list) map.set(c.base, c);

    /* 自选库跨页共享，池内没有的币（比如 BTC、SOL）补查现货行情 */
    const hasQuote = typeof Quote !== 'undefined';
    const need = hasQuote
      ? Array.from(new Set(Watch.allBases())).filter(b => !map.has(b) && (!Quote.get(b) || !Quote.fresh(b)))
      : [];
    if (need.length) {
      Quote.ensure(need).then(got => {
        if (got && el.watchDrawer && !el.watchDrawer.hidden) renderWatchDrawer();
      });
    }

    if (el.wdSub) {
      el.wdSub.textContent = dirs.length
        ? `${total} 个币种 · ${dirs.length} 个目录`
        : '还没有自选';
    }

    if (!dirs.length) {
      el.wdBody.innerHTML = `<div class="wdd-empty">
        还没有自选股。<br>
        在左侧榜单点行尾的 <b>☆</b>，或在币种详情里点「加入自选」。<br><br>
        最多 10 个目录，每个目录 50 个币种。
      </div>`;
      return;
    }

    el.wdBody.innerHTML = dirs.map(d => {
      const rows = d.bases.length ? d.bases.map(b => {
        const c = map.get(b);
        const s = c && c.score;
        const q = (!c && hasQuote) ? Quote.get(b) : null;
        const price = c ? c.price : (q ? q.price : null);
        const chg = c ? c.change24h : (q ? q.change : null);
        const sub = c
          ? esc(nameSub(b, c.name))
          : (q ? 'USDT · <span>现货</span>' : '未收录');
        return `<div class="wdd-row" data-base="${esc(b)}">
          <img alt="" loading="lazy" src="${iconSrc(b)}"
               onerror="this.onerror=null;this.src='${letterAvatar(b)}'">
          <div class="wdd-id">
            <b>${esc(b)}</b>
            <em>${sub}</em>
          </div>
          <div class="wdd-px">
            <span class="wdd-price">${price !== null && price !== undefined ? fmtPrice(price) : '—'}</span>
            <span class="wdd-chg ${chg !== null && chg !== undefined ? dirClass(chg) : 'flat'}">${chg !== null && chg !== undefined ? fmtPct(chg) : '—'}</span>
          </div>
          <span class="grade-badge ${s ? 'grade-' + s.grade : 'grade-none'}">${s ? s.grade : '·'}</span>
          <button class="wdd-rm" data-rm="${esc(b)}" data-dir="${esc(d.id)}" title="移出自选">×</button>
        </div>`;
      }).join('') : '<div class="wdd-empty-coins">空目录</div>';

      return `<div class="wdd-group">
        <div class="wdd-head">
          <span class="wdd-name">${esc(d.name)}</span>
          <span class="wdd-count">${d.count}/${d.capacity}</span>
        </div>
        <div class="wdd-rows">${rows}</div>
      </div>`;
    }).join('');
  }

  function openWatchDrawer() {
    if (!el.watchDrawer) return;
    renderWatchDrawer();
    el.watchDrawer.hidden = false;
    if (el.watchMask) el.watchMask.hidden = false;
  }

  function closeWatchDrawer() {
    if (el.watchDrawer) el.watchDrawer.hidden = true;
    if (el.watchMask) el.watchMask.hidden = true;
  }

  /* ---------------- 详情抽屉 ---------------- */

  let drawerBase = null;

  function scoreColor(v) {
    if (v >= 68) return '#0ecb81';
    if (v >= 55) return '#5b9dff';
    if (v >= 42) return '#f0b90b';
    return '#f6465d';
  }

  function openDrawer(c) {
    if (!el.drawer || !c) return;
    drawerBase = c.base;
    const s = c.score;

    el.dIcon.src = iconSrc(c.base);
    el.dIcon.onerror = function () { this.onerror = null; this.src = letterAvatar(c.base); };
    const sub = nameSub(c.base, c.name);
    el.dName.textContent = sub ? c.base + ' · ' + sub : c.base;
    el.dSub.textContent = `上线 ${fmtAge(c.ageDays)} · ${Object.keys(c.exchanges || {}).length} 家交易所 · 知识库 ${c.snapDays || 0} 天`;

    el.dPrice.textContent = fmtPrice(c.price);
    el.dChange.textContent = fmtPct(c.change24h);
    el.dChange.className = 'dp-chg ' + dirClass(c.change24h);

    if (s) {
      const col = scoreColor(s.total);
      el.dRing.style.background = `conic-gradient(${col} ${s.total * 3.6}deg, rgba(255,255,255,.07) 0)`;
      el.dRing.innerHTML = `<span style="position:absolute;inset:4px;border-radius:50%;background:#11161d;
        display:flex;align-items:center;justify-content:center"><b style="color:${col}">${s.total.toFixed(0)}</b></span>`;
      el.dRel.textContent = s.reliability.toFixed(0);
      el.dPot.textContent = s.potential.toFixed(0);
      el.dTotal.textContent = s.total.toFixed(1);
      el.dGrade.innerHTML = `<span class="grade-badge grade-${s.grade}">${s.grade}</span>
        <span style="font-size:9.5px;color:var(--text-mute)">${esc(s.tag.label)}</span>`;
      el.dRelSum.textContent = `${s.reliability.toFixed(1)} / 100`;
      el.dPotSum.textContent = `${s.potential.toFixed(1)} / 100`;
      el.dRelFactors.innerHTML = s.relFactors.map(factorRow).join('');
      el.dPotFactors.innerHTML = s.potFactors.map(factorRow).join('');
    } else {
      el.dRelFactors.innerHTML = '<div class="f-note">评分不可用</div>';
      el.dPotFactors.innerHTML = '';
    }

    renderReason(c);

    // 各所报价
    const exRows = EX_ORDER
      .filter(ex => c.exchanges && c.exchanges[ex])
      .map(ex => {
        const t = c.exchanges[ex];
        return `<div class="ex-row">
          <span class="ex-name"><span class="ex-chip ${ex}">${EX_LABEL[ex]}</span></span>
          <span class="ex-price">${fmtPrice(t.price)}</span>
          <span class="ex-qv">${fmtMoney(t.qv)}</span>
        </div>`;
      });
    el.dExchanges.innerHTML = exRows.length ? exRows.join('') :
      '<div class="f-note">无报价数据</div>';

    // 知识库记录
    if (el.dKbInfo) {
      const sinceList = c.firstPrice > 0 && c.price > 0 ? (c.price / c.firstPrice - 1) * 100 : null;
      // 知识库还没攒够历史时，用 24h 高点作为临时参考，并注明来源
      const refMax = c.histMax > 0 ? c.histMax : (c.high24h > 0 ? c.high24h : 0);
      const refLabel = c.histMax > 0 ? '记录最高价' : '24h 高点';
      const fromHist = refMax > 0 && c.price > 0 ? (c.price / refMax - 1) * 100 : null;
      el.dKbDays.textContent = (c.snapDays || 0) + ' 天快照';
      el.dKbInfo.innerHTML = [
        ['上线时间', new Date(c.listedAt).toLocaleDateString('zh-CN')],
        ['已上线', fmtAge(c.ageDays)],
        ['首次观测价', c.firstPrice > 0 ? fmtPrice(c.firstPrice) : '—'],
        [refLabel, refMax > 0 ? fmtPrice(refMax) : '—'],
        ['较首次观测', sinceList == null ? '—' : fmtPct(sinceList)],
        [c.histMax > 0 ? '较记录高点' : '较 24h 高点', fromHist == null ? '—' : fmtPct(fromHist)],
      ].map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    }

    // 目录选择
    const dirs = Watch.listDirs();
    const inDirs = Watch.dirsOf(c.base);
    el.dDirSelect.innerHTML = dirs.length
      ? `<select id="dDirSelectEl">${dirs.map(d =>
          `<option value="${esc(d.id)}"${inDirs.some(x => x.id === d.id) ? ' disabled' : ''}>${esc(d.name)} (${d.count}/50)</option>`
        ).join('')}</select>`
      : '<select id="dDirSelectEl"><option value="">（无目录，将自动创建）</option></select>';

    el.dWatch.textContent = inDirs.length ? '移出自选' : '加入自选';
    el.dWatch.dataset.base = c.base;

    el.drawer.hidden = false;
    el.drawerMask.hidden = false;
  }

  function factorRow(f) {
    const pct = f.max > 0 ? (f.score / f.max * 100) : 0;
    const cls = [f.warn ? '' : '', f.flag === 'warn' ? 'warn' : '', f.flag === 'danger' ? 'danger' : '',
      f.missing ? 'missing' : ''].filter(Boolean).join(' ');
    return `<div class="f-row ${cls}">
      <span class="f-label">${esc(f.label)}</span>
      <span class="f-note" title="${esc(f.note)}">${esc(f.note)}</span>
      <span class="f-score" style="--w:${pct}%">${f.score}<span style="color:var(--text-mute);font-size:9px">/${f.max}</span></span>
    </div>`;
  }

  /* ---------------- 评分理由 ---------------- */

  const TONE_COLOR = { good: '#0ecb81', mid: '#5b9dff', warn: '#f0b90b', danger: '#f6465d' };

  function fmtScoreVal(v) {
    return Number.isInteger(v) ? String(v) : Number(v).toFixed(1);
  }

  function reasonItem(f, kind) {
    const pct = f.max > 0 ? Math.max(0, Math.min(100, f.score / f.max * 100)) : 0;
    const col = kind === 'good' ? '#0ecb81'
      : f.flag === 'danger' ? '#f6465d'
      : f.flag === 'warn' ? '#f0b90b' : '#5b9dff';
    const tail = kind === 'bad' && f.loss > 0
      ? `<i class="rci-loss">−${fmtScoreVal(f.loss)}</i>` : '';
    return `<div class="rc-item">
      <div class="rci-top">
        <span class="rci-lab">${esc(f.label)}${f.missing ? '<em>缺数据</em>' : ''}</span>
        <span class="rci-v"><b>${fmtScoreVal(f.score)}</b><span>/${f.max}</span>${tail}</span>
      </div>
      <div class="rci-bar"><i style="width:${pct}%;background:${col}"></i></div>
      <div class="rci-note">${esc(f.note)}</div>
    </div>`;
  }

  /**
   * 把 Score.explain() 的结构化理由渲染成抽屉里的「评分理由」块。
   * 顺序按阅读逻辑：结论 → 加权拆解 → 加分项 → 失分项 → 升档路径 → 风险 → 数据缺口
   */
  function renderReason(c) {
    if (!el.dReason) return;
    const s = c.score;
    const ex = (s && typeof Score !== 'undefined' && Score.explain) ? Score.explain(s) : null;
    if (!ex) { el.dReason.innerHTML = ''; return; }

    const tone = s.hasDanger ? 'danger' : s.hasWarn ? 'warn'
      : (s.grade === 'A' || s.grade === 'B') ? 'good' : 'mid';
    const col = TONE_COLOR[tone];

    const relC = s.reliability * ex.weightRel / 100;
    const potC = s.potential * ex.weightPot / 100;
    const html = [];

    html.push(`<div class="rc-lead-card" style="--tone:${col}">
      <p class="rc-lead">${esc(ex.head)}</p>
      <p class="rc-why">${esc(ex.whyGrade)}</p>
    </div>`);

    html.push(`<div class="rc-weights">
      <div class="rcw-row">
        <span class="rcw-k">可靠性 ×55%</span>
        <span class="rcw-bar"><i style="width:${Math.min(100, s.reliability)}%;background:#5b9dff"></i></span>
        <span class="rcw-v">${s.reliability.toFixed(1)} → <b>${relC.toFixed(1)}</b></span>
      </div>
      <div class="rcw-row">
        <span class="rcw-k">潜力 ×45%</span>
        <span class="rcw-bar"><i style="width:${Math.min(100, s.potential)}%;background:#f0b90b"></i></span>
        <span class="rcw-v">${s.potential.toFixed(1)} → <b>${potC.toFixed(1)}</b></span>
      </div>
      <div class="rcw-sum">
        <span>加权合计</span>
        <span><b>${(relC + potC).toFixed(1)}</b> 分 · ${s.grade} 级</span>
      </div>
    </div>`);

    if (ex.strengths.length) {
      html.push(`<div class="rc-sec">
        <div class="rc-sec-t">加分项 · 分是从这里来的</div>
        ${ex.strengths.map(f => reasonItem(f, 'good')).join('')}
      </div>`);
    }

    if (ex.weaknesses.length) {
      html.push(`<div class="rc-sec">
        <div class="rc-sec-t">失分项 · 拖后腿的地方</div>
        ${ex.weaknesses.map(f => reasonItem(f, 'bad')).join('')}
      </div>`);
    }

    if (ex.next) {
      html.push(`<div class="rc-next ${ex.next.gapTotal === 0 ? 'ok' : ''}">
        <span class="rcn-k">距 ${esc(ex.next.grade)} 级</span>
        <span class="rcn-v">${esc(ex.next.text)}</span>
      </div>`);
    } else {
      html.push(`<div class="rc-next ok">
        <span class="rcn-k">最高档</span>
        <span class="rcn-v">A 级门槛（综合 ≥68、可靠性 ≥55）已满足</span>
      </div>`);
    }

    if (ex.risks.length) {
      html.push(`<div class="rc-sec">
        <div class="rc-sec-t">风险信号</div>
        ${ex.risks.map(r =>
          `<div class="rc-risk ${r.flag}"><b>${esc(r.label)}</b>${esc(r.note)}</div>`
        ).join('')}
      </div>`);
    }

    if (ex.missing.length) {
      html.push(`<div class="rc-missing">
        <b>${ex.missing.length} 项缺数据，按中性计分</b>
        ${ex.missing.map(m => esc(m.label)).join('、')}。这几项的真实表现可能更好也可能更差，对应分数要打折看。
      </div>`);
    }

    html.push(`<div class="rc-ver">模型 ${esc(s.modelVersion || Score.MODEL_VERSION)} · 12 因子定权 · 无拟合</div>`);

    el.dReason.innerHTML = html.join('');
  }

  function closeDrawer() {
    if (el.drawer) el.drawer.hidden = true;
    if (el.drawerMask) el.drawerMask.hidden = true;
    drawerBase = null;
  }

  function getDrawerBase() { return drawerBase; }

  function openMethod() {
    if (!el.methodDrawer) return;
    el.methodDrawer.hidden = false;
    el.methodMask.hidden = false;
  }
  function closeMethod() {
    if (el.methodDrawer) el.methodDrawer.hidden = true;
    if (el.methodMask) el.methodMask.hidden = true;
  }

  /* ---------------- Toast ---------------- */

  let toastTimer = null;
  function toast(msg, kind) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    el.toast.style.borderColor = kind === 'error' ? 'rgba(246,70,93,.5)'
      : kind === 'ok' ? 'rgba(14,203,129,.5)' : 'var(--border)';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }

  function bindOnce() {
    bind();
  }

  return {
    bindOnce, bind,
    renderWindowTabs, renderScope, renderKPI, renderTable,
    renderKB, renderWatch, renderMethodProof,
    renderWatchNav, renderWatchDrawer, openWatchDrawer, closeWatchDrawer,
    openDrawer, closeDrawer, getDrawerBase,
    openMethod, closeMethod,
    toast,
    fmtPrice, fmtMoney, fmtPct, fmtAge, esc, letterAvatar, iconSrc,
    median, openDirs,
    el,
  };
})();

if (typeof window !== 'undefined') window.NCRender = NCRender;

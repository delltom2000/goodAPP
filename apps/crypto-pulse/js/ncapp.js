/* ==========================================================================
   NCApp — 新币雷达主控
   ========================================================================== */
(() => {
  'use strict';

  const R = NCRender;
  const el = {};

  /* 同步节奏：前台 5 分钟全量；后台 30 分钟（省流量、省电） */
  const SYNC_VISIBLE = 5 * 60 * 1000;
  const SYNC_HIDDEN = 30 * 60 * 1000;

  /* 本页不加载 config.js，时间格式化在这里就地实现（与主站 fmtClock 一致） */
  function fmtClock(ts) {
    if (!ts) return '--:--';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '--:--';
    const p = n => (n < 10 ? '0' : '') + n;
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 渲染出口统一过 i18n；中文模式内部直接返回，无额外开销 */
  (function wrapI18n() {
    const names = ['renderTable', 'renderKPI', 'renderScope', 'renderKB', 'renderWatch',
      'renderWatchDrawer', 'renderMethodProof', 'openDrawer', 'renderMethod'];
    names.forEach(k => {
      const f = R[k];
      if (typeof f !== 'function') return;
      R[k] = function () {
        const out = f.apply(R, arguments);
        if (window.I18N) I18N.apply(document.body);
        return out;
      };
    });
  })();

  /* 切换语言后重跑一次全量渲染，动态内容跟随 */
  if (window.I18N) {
    I18N.onChange(() => {
      try { paintAll(NewFeed.getState()); } catch (e) {}
    });
  }

  const view = {
    search: '',
    grade: 'all',
    exchange: 'all',
    watch: 'all',
    sortKey: 'scoreRank',
    sortDir: 1,        // 1 = 升序，-1 = 降序
  };

  const SORT_LABEL = {
    scoreRank: '综合分',
    base: '币种名',
    ageDays: '上线时长',
    price: '价格',
    change24h: '24h 涨跌',
    quoteVolume: '成交额',
    marketCap: '市值',
    exchanges: '交易所数',
    reliability: '可靠性',
    potential: '潜力',
    total: '综合分',
    grade: '评级',
  };

  let refreshTimer = null;

  /* ---------------- 视图计算 ---------------- */

  function currentList() {
    const st = NewFeed.getState();
    let list = st.list || [];

    const q = view.search.trim().toUpperCase();
    if (q) {
      list = list.filter(c =>
        c.base.includes(q) || String(c.name || '').toUpperCase().includes(q));
    }

    if (view.grade === 'A') list = list.filter(c => c.score && c.score.grade === 'A');
    else if (view.grade === 'B') list = list.filter(c => c.score && c.score.grade === 'B');
    else if (view.grade === 'AB') list = list.filter(c => c.score && (c.score.grade === 'A' || c.score.grade === 'B'));
    else if (view.grade === 'avoid') list = list.filter(c => c.score && (c.score.hasDanger || c.score.grade === 'D'));

    if (view.exchange !== 'all') {
      if (view.exchange === 'multi') list = list.filter(c => Object.keys(c.exchanges || {}).length >= 3);
      else list = list.filter(c => c.exchanges && c.exchanges[view.exchange]);
    }

    if (view.watch === 'watch') list = list.filter(c => Watch.has(c.base));

    const key = view.sortKey;
    list = [...list].sort((a, b) => {
      let av, bv;
      switch (key) {
        case 'base': av = a.base; bv = b.base; break;
        case 'exchanges': av = Object.keys(a.exchanges || {}).length; bv = Object.keys(b.exchanges || {}).length; break;
        case 'reliability': av = a.score ? a.score.reliability : 0; bv = b.score ? b.score.reliability : 0; break;
        case 'potential': av = a.score ? a.score.potential : 0; bv = b.score ? b.score.potential : 0; break;
        case 'total': av = a.score ? a.score.total : 0; bv = b.score ? b.score.total : 0; break;
        case 'grade': {
          const order = { A: 4, B: 3, C: 2, D: 1 };
          av = a.score ? order[a.score.grade] : 0;
          bv = b.score ? order[b.score.grade] : 0;
          break;
        }
        case 'scoreRank': av = a.scoreRank || 0; bv = b.scoreRank || 0; break;
        default: av = a[key] || 0; bv = b[key] || 0;
      }
      if (typeof av === 'string') return av.localeCompare(bv) * view.sortDir;
      return (av - bv) * view.sortDir;
    });

    return list;
  }

  function paint() {
    const list = currentList();
    const st = NewFeed.getState();
    R.renderTable(list, {
      total: (st.list || []).length,
      sortLabel: SORT_LABEL[view.sortKey] || '综合分',
    });
    updateSortHeaders();
  }

  function updateSortHeaders() {
    document.querySelectorAll('.nc-table thead th[data-sort]').forEach(th => {
      const active = th.dataset.sort === view.sortKey;
      th.dataset.active = active ? 'true' : 'false';
      th.dataset.dir = active ? (view.sortDir === 1 ? '▲' : '▼') : '';
    });
  }

  /* ---------------- 同步 ---------------- */

  async function syncAll(force) {
    setConn('loading', force ? '正在重新抓取…' : '正在同步各交易所…');
    try {
      const st = await NewFeed.sync({ force: !!force });
      paintAll(st);
      setConn('ready', null);
    } catch (e) {
      const st = NewFeed.getState();
      if (st.offline && st.list && st.list.length) {
        // 有本地留存：照常展示，只把「几点」标清楚
        paintAll(st);
        setConn('offline', `离线数据 · ${fmtClock(st.cachedAt)}`);
        R.toast(`同步失败，已显示 ${fmtClock(st.cachedAt)} 的离线数据`, 'error');
        return;
      }
      setConn('error', '同步失败：' + (e.message || e));
      R.toast('同步失败：' + (e.message || e), 'error');
      const tb = document.getElementById('newBody');
      if (tb) {
        tb.innerHTML = `<tr class="nc-empty-row"><td colspan="13">
          数据抓取失败：${R.esc(e.message || String(e))}<br>
          请检查网络是否能访问 OKX / Gate / Bitget 的公开接口，然后点右上角刷新重试。
        </td></tr>`;
      }
    }
  }

  function paintAll(st) {
    R.renderScope(st.list || [], { windowDays: st.windowDays, maxPool: NewFeed.MAX_POOL });
    R.renderKPI(st.list || [], { windowDays: st.windowDays, maxPool: NewFeed.MAX_POOL });
    R.renderKB(st.kbStats, st.list || []);
    paint();
    updateTableMeta(st);
    if (R.el.watchDrawer && !R.el.watchDrawer.hidden) R.renderWatchDrawer();
  }

  function updateTableMeta(st) {
    const meta = document.getElementById('tableMeta');
    if (!meta) return;
    const fs = st.filterStats || {};
    const removed = [
      (fs.gate_leveraged || 0) + (fs.okx_leveraged || 0) + (fs.bitget_leveraged || 0),
      (fs.gate_equity || 0) + (fs.okx_equity || 0) + (fs.binance_equity || 0),
      (fs.bitget_synthetic || 0),
      (fs.okx_stable || 0) + (fs.gate_stable || 0) + (fs.bitget_stable || 0),
    ];
    const totalRemoved = removed.reduce((a, b) => a + b, 0);
    const n = (st.list || []).length;
    meta.textContent = `${n} 个项目 · 已剔除 ${totalRemoved} 个非加密标的（杠杆代币 ${removed[0]}、代币化股票 ${removed[1]}、合成资产 ${removed[2]}、稳定币 ${removed[3]}）`;
  }

  function setConn(state, text) {
    const box = document.getElementById('conn');
    const txt = document.getElementById('connText');
    if (!box || !txt) return;
    box.dataset.state = state;
    if (text) { txt.textContent = text; return; }
    const st = NewFeed.getState();
    if (state === 'ready') {
      txt.textContent = st.lastSync ? `已同步 · ${fmtClock(st.lastSync)}` : '已同步';
    } else if (state === 'offline') {
      txt.textContent = `离线数据 · ${fmtClock(st.cachedAt)}`;
    }
  }

  /* ---------------- 自选 ---------------- */

  function toggleWatch(base, dirId) {
    const r = Watch.toggle(dirId, base);
    R.toast(r.message, r.ok ? 'ok' : 'error');
    if (r.ok) {
      paint();
      R.renderWatch();
      if (R.el.watchDrawer && !R.el.watchDrawer.hidden) R.renderWatchDrawer();
      if (R.getDrawerBase() === base) {
        const c = (NewFeed.getState().list || []).find(x => x.base === base);
        if (c) R.openDrawer(c);
      }
    }
    return r;
  }

  function bindWatchPanel() {
    const body = document.getElementById('watchBody');
    if (!body) return;

    body.addEventListener('click', ev => {
      const toggle = ev.target.closest('[data-toggle]');
      if (toggle) {
        const id = toggle.dataset.toggle;
        if (R.openDirs.has(id)) R.openDirs.delete(id); else R.openDirs.add(id);
        R.renderWatch();
        return;
      }

      const ren = ev.target.closest('[data-rename]');
      if (ren) {
        ev.stopPropagation();
        const id = ren.dataset.rename;
        const dir = Watch.listDirs().find(d => d.id === id);
        const name = prompt('重命名目录', dir ? dir.name : '');
        if (name != null) {
          const r = Watch.renameDir(id, name);
          R.toast(r.message, r.ok ? 'ok' : 'error');
          R.renderWatch();
        }
        return;
      }

      const del = ev.target.closest('[data-del]');
      if (del) {
        ev.stopPropagation();
        const id = del.dataset.del;
        const dir = Watch.listDirs().find(d => d.id === id);
        if (confirm(`删除目录「${dir ? dir.name : ''}」？里面的 ${dir ? dir.count : 0} 个币种也会一起移除。`)) {
          const r = Watch.removeDir(id);
          R.toast(r.message, r.ok ? 'ok' : 'error');
          R.openDirs.delete(id);
          R.renderWatch();
          paint();
        }
        return;
      }

      const rm = ev.target.closest('[data-rm]');
      if (rm) {
        ev.stopPropagation();
        const r = Watch.remove(rm.dataset.dir, rm.dataset.rm);
        R.toast(r.message, r.ok ? 'ok' : 'error');
        R.renderWatch();
        paint();
      }
    });
  }

  function bindDirCreate() {
    const btn = document.getElementById('newDirBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cap = Watch.capacity();
      if (cap.leftDirs <= 0) {
        R.toast(`最多 ${cap.maxDirs} 个目录，请先删除一个`, 'error');
        return;
      }
      const name = prompt(`新建自选目录（还剩 ${cap.leftDirs} 个名额）`, `自选 ${cap.usedDirs + 1}`);
      if (name == null) return;
      const r = Watch.createDir(name);
      R.toast(r.message, r.ok ? 'ok' : 'error');
      if (r.ok) {
        R.openDirs.add(r.dir.id);
        R.renderWatch();
      }
    });
  }

  function bindImportExport() {
    const ex = document.getElementById('watchExportBtn');
    const im = document.getElementById('watchImportBtn');
    if (ex) {
      ex.addEventListener('click', () => {
        const json = Watch.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'watchlist-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        R.toast('已导出自选库', 'ok');
      });
    }
    if (im) {
      im.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', () => {
          const f = input.files && input.files[0];
          if (!f) return;
          const fr = new FileReader();
          fr.onload = () => {
            const r = Watch.importJSON(String(fr.result), 'merge');
            R.toast(r.message, r.ok ? 'ok' : 'error');
            R.renderWatch();
            paint();
          };
          fr.readAsText(f);
        });
        input.click();
      });
    }
  }

  /* ---------------- 表格与抽屉事件 ---------------- */

  function bindTable() {
    const body = document.getElementById('newBody');
    if (!body) return;

    body.addEventListener('click', ev => {
      const wb = ev.target.closest('[data-watch]');
      if (wb) {
        ev.stopPropagation();
        toggleWatch(wb.dataset.watch);
        return;
      }
      const tr = ev.target.closest('tr[data-base]');
      if (tr) openDetail(tr.dataset.base);
    });

    body.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const tr = ev.target.closest('tr[data-base]');
      if (tr) { ev.preventDefault(); openDetail(tr.dataset.base); }
    });

    document.querySelectorAll('.nc-table thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (view.sortKey === key) {
          view.sortDir = -view.sortDir;
        } else {
          view.sortKey = key;
          // 数值默认降序，文字默认升序
          view.sortDir = (key === 'base' || key === 'scoreRank') ? 1 : -1;
        }
        paint();
      });
    });
  }

  function openDetail(base) {
    const c = (NewFeed.getState().list || []).find(x => x.base === base);
    if (c) R.openDrawer(c);
  }

  function bindDrawer() {
    const close = document.getElementById('dClose');
    const mask = document.getElementById('drawerMask');
    const watchBtn = document.getElementById('dWatch');
    if (close) close.addEventListener('click', R.closeDrawer);
    if (mask) mask.addEventListener('click', R.closeDrawer);
    if (watchBtn) {
      watchBtn.addEventListener('click', () => {
        const base = watchBtn.dataset.base;
        if (!base) return;
        const sel = document.getElementById('dDirSelectEl');
        const dirId = sel && sel.value ? sel.value : null;
        toggleWatch(base, dirId || undefined);
      });
    }

    const mClose = document.getElementById('methodClose');
    const mMask = document.getElementById('methodMask');
    if (mClose) mClose.addEventListener('click', R.closeMethod);
    if (mMask) mMask.addEventListener('click', R.closeMethod);

    const mBtn = document.getElementById('methodBtn');
    if (mBtn) mBtn.addEventListener('click', R.openMethod);

    bindWatchPanelDrawer();

    // ESC 关闭所有浮层，从最上层开始
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      if (R.el.watchDrawer && !R.el.watchDrawer.hidden) {
        R.closeWatchDrawer();
        return;
      }
      const md = R.el.methodDrawer;
      if (!md || md.hidden) {
        R.closeDrawer();
      } else {
        R.closeMethod();
      }
    });
  }

  /* ---------------- 自选股面板 ---------------- */

  function bindWatchPanelDrawer() {
    const navBtn = document.getElementById('watchNavBtn');
    const close = document.getElementById('wdClose');
    const mask = document.getElementById('watchMask');
    const body = document.getElementById('wdBody');
    const manage = document.getElementById('wdManage');
    const addDir = document.getElementById('wdAddDir');

    if (navBtn) navBtn.addEventListener('click', () => R.openWatchDrawer());
    if (close) close.addEventListener('click', R.closeWatchDrawer);
    if (mask) mask.addEventListener('click', R.closeWatchDrawer);

    if (manage) {
      manage.addEventListener('click', () => {
        R.closeWatchDrawer();
        const panel = document.getElementById('watchPanel');
        if (panel) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          panel.classList.add('flash');
          setTimeout(() => panel.classList.remove('flash'), 1200);
        }
      });
    }

    if (addDir) {
      addDir.addEventListener('click', () => {
        const cap = Watch.capacity();
        if (cap.leftDirs <= 0) {
          R.toast(`最多 ${cap.maxDirs} 个目录，请先删除一个`, 'error');
          return;
        }
        const name = prompt(`新建自选目录（还剩 ${cap.leftDirs} 个名额）`, `自选 ${cap.usedDirs + 1}`);
        if (name == null) return;
        const r = Watch.createDir(name);
        R.toast(r.message, r.ok ? 'ok' : 'error');
        if (r.ok) {
          R.renderWatch();
          R.renderWatchDrawer();
          paint();
        }
      });
    }

    if (body) {
      body.addEventListener('click', ev => {
        const rm = ev.target.closest('[data-rm]');
        if (rm) {
          ev.stopPropagation();
          const r = Watch.remove(rm.dataset.dir, rm.dataset.rm);
          R.toast(r.message, r.ok ? 'ok' : 'error');
          R.renderWatch();
          R.renderWatchDrawer();
          paint();
          return;
        }
        const row = ev.target.closest('[data-base]');
        if (row) {
          const base = row.dataset.base;
          R.closeWatchDrawer();
          openDetail(base);
        }
      });
    }
  }

  /* ---------------- 顶栏 ---------------- */

  function bindTopbar() {
    const refresh = document.getElementById('refreshBtn');
    if (refresh) {
      refresh.addEventListener('click', () => {
        NewFeed.invalidateCache();
        syncAll(true);
      });
    }

    const paletteBtn = document.getElementById('paletteBtn');
    if (paletteBtn) {
      paletteBtn.addEventListener('click', () => {
        const cur = document.documentElement.dataset.palette || 'cn';
        const next = cur === 'cn' ? 'global' : 'cn';
        document.documentElement.dataset.palette = next;
        const t = document.getElementById('paletteText');
        if (t) t.textContent = next === 'cn' ? '红涨' : '绿涨';
        try { localStorage.setItem('cp.palette', next); } catch (e) {}
      });
    }

    // 恢复配色偏好
    try {
      const saved = localStorage.getItem('cp.palette');
      if (saved === 'global' || saved === 'cn') {
        document.documentElement.dataset.palette = saved;
        const t = document.getElementById('paletteText');
        if (t) t.textContent = saved === 'cn' ? '红涨' : '绿涨';
      }
    } catch (e) {}
  }

  function tickClock() {
    const c = document.getElementById('clock');
    if (!c) return;
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    c.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ---------------- 筛选控件 ---------------- */

  function bindFilters() {
    const s = document.getElementById('searchInput');
    if (s) {
      let t = null;
      s.addEventListener('input', () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => { view.search = s.value; paint(); }, 180);
      });
    }
    const g = document.getElementById('gradeFilter');
    if (g) g.addEventListener('change', () => { view.grade = g.value; paint(); });

    const e = document.getElementById('exFilter');
    if (e) e.addEventListener('change', () => { view.exchange = e.value; paint(); });

    const w = document.getElementById('watchFilter');
    if (w) w.addEventListener('change', () => { view.watch = w.value; paint(); });
  }

  // 窗口标签：切换后重建按钮并本地重算（数据有 5 分钟缓存，不重复打接口）
  function renderTabs() {
    const cur = NewFeed.getState().windowDays;
    R.renderWindowTabs(NewFeed.WINDOWS, cur, async w => {
      NewFeed.setWindow(w);
      renderTabs();
      await syncAll(false);
    });
  }

  /* ---------------- 初始化 ---------------- */

  async function init() {
    R.bindOnce();

    // 全局错误提示
    if (window.__errs && window.__errs.length) {
      R.toast('页面有脚本错误，详见控制台', 'error');
    }

    tickClock();
    setInterval(tickClock, 1000);

    bindTopbar();
    bindFilters();
    bindTable();
    bindDrawer();
    bindWatchPanel();
    bindDirCreate();
    bindImportExport();
    renderTabs();

    // 自选变更时同步表格星标与顶部计数
    Watch.onChange(() => {
      R.renderWatch();
      if (R.el.watchDrawer && !R.el.watchDrawer.hidden) R.renderWatchDrawer();
    });

    R.renderWatch();
    R.renderKB(null, []);

    // 先把上次的榜单铺出来，网络慢或不通也不空着
    if (NewFeed.restore()) {
      paintAll(NewFeed.getState());
      setConn('offline', null);
    }

    await syncAll(false);

    // 打开模型说明时展示实际区分度
    const st = NewFeed.getState();
    if (st.list && st.list.length && typeof Score !== 'undefined') {
      R.renderMethodProof(Score.distribution(st.list));
    }

    // 前台每 5 分钟全量同步；切到后台降到 30 分钟，别在后台偷跑流量
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      const st = NewFeed.getState();
      if (st.loading) return;
      const gap = document.hidden ? SYNC_HIDDEN : SYNC_VISIBLE;
      if (Date.now() - (st.lastSync || 0) < gap) return;
      NewFeed.invalidateCache();
      syncAll(true);
    }, 30000);

    // 回到前台：离线状态或数据已过期，补一次
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const st = NewFeed.getState();
      if (st.loading) return;
      if (st.offline || Date.now() - (st.lastSync || 0) > SYNC_VISIBLE) syncAll(false);
    });

    // 连接状态里的时间点每分钟校准一次
    setInterval(() => {
      const s = NewFeed.getState();
      if (s.offline) setConn('offline', null);
      else if (s.lastSync) setConn('ready', null);
    }, 30000);

    // 暴露给调试/测试
    window.__nc = { view, paint, syncAll, currentList };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

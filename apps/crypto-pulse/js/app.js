/* ============================================================
   app.js — 主控：事件绑定 / 渲染调度 / 交互状态
   ============================================================ */

'use strict';

(function () {

  const { el, view } = Render;

  /* 所有渲染出口统一过一遍 i18n：英文模式下渲染完立刻把界面文案换掉，
     中文模式 I18N.apply 内部直接返回，零开销 */
  (function wrapI18n() {
    const names = ['renderTable', 'renderKPI', 'renderBreadth', 'renderFlow', 'renderLeader',
      'renderSignals', 'renderStatus', 'renderScope', 'renderKB', 'renderWatch',
      'renderWatchDrawer', 'renderMethodProof', 'openDrawer'];
    names.forEach(k => {
      const f = Render[k];
      if (typeof f !== 'function') return;
      Render[k] = function () {
        const out = f.apply(Render, arguments);
        if (window.I18N) I18N.apply(document.body);
        return out;
      };
    });
  })();

  /* 切换语言后重跑一次全量渲染，动态内容跟随 */
  if (window.I18N) {
    I18N.onChange(() => {
      if (lastMetrics) renderFull();
      else Render.renderStatus(DataFeed.getState());
    });
  }

  let lastMetrics = null;
  let fullRenderTimer = null;
  let lastFullRenderAt = 0;
  const FULL_RENDER_MIN_GAP = 900;   // 全量渲染最小间隔，避免面板频繁抖动

  /* ============================================================
     主题：涨跌配色
     ============================================================ */
  /* 其他页面/标签页改动自选库时，本页同步星标 */
  if (typeof Watch !== 'undefined') {
    Watch.onChange(() => {
      view.watch = new Set(Watch.allBases());
      Render.renderTable(DataFeed.getList());
    });
  }

  function applyPalette(mode) {
    document.documentElement.dataset.palette = mode;
    const isCN = mode !== 'global';
    document.getElementById('paletteText').textContent = isCN ? '红涨' : '绿涨';
    document.getElementById('paletteBtn').title =
      isCN ? '当前红涨绿跌（中国习惯），点击切换为绿涨红跌' : '当前绿涨红跌（国际习惯），点击切换为红涨绿跌';
    lsSet(CFG.PALETTE_KEY, mode);
    Render.refreshPalette();
    if (lastMetrics) {
      Render.renderBreadth(lastMetrics);
      Render.renderFlow(lastMetrics);
      Render.renderSignals(lastMetrics);
    }
    // 重新着色表格内的走势条
    if (lastMetrics) Render.renderTable(DataFeed.getList());
    renderClock();
  }

  function applyDensity(mode) {
    document.documentElement.dataset.density = mode;
    document.getElementById('densityBtn').textContent = mode === 'compact' ? '舒适' : '紧凑';
    lsSet(CFG.DENSITY_KEY, mode);
  }

  /* ============================================================
     时钟
     ============================================================ */
  function renderClock() {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    const p = n => String(n).padStart(2, '0');
    el.clock.textContent = `${p(bj.getHours())}:${p(bj.getMinutes())}:${p(bj.getSeconds())}`;
  }

  /* ============================================================
     渲染调度
     ============================================================ */
  function renderFull() {
    const list = DataFeed.getList();
    if (list.length === 0) return;

    lastMetrics = Analytics.compute(list);

    Render.renderStatus(DataFeed.getState());
    Render.renderKPI(lastMetrics, DataFeed.getState());
    Render.renderBreadth(lastMetrics);
    Render.renderFlow(lastMetrics);
    Render.renderLeader(lastMetrics);
    Render.renderSignals(lastMetrics);
    Render.renderTable(list);

    lastFullRenderAt = performance.now();
  }

  function scheduleFullRender(force) {
    const now = performance.now();
    const gap = now - lastFullRenderAt;

    if (force || gap >= FULL_RENDER_MIN_GAP) {
      if (fullRenderTimer) { clearTimeout(fullRenderTimer); fullRenderTimer = null; }
      renderFull();
      return;
    }
    if (fullRenderTimer) return;
    fullRenderTimer = setTimeout(() => {
      fullRenderTimer = null;
      renderFull();
    }, FULL_RENDER_MIN_GAP - gap);
  }

  /* ============================================================
     数据订阅
     ============================================================ */
  function wireData() {
    DataFeed.on('status', () => {
      Render.renderStatus(DataFeed.getState());
    });

    DataFeed.on('update', (payload) => {
      if (payload && payload.full) {
        scheduleFullRender(false);
      } else if (payload && payload.partial) {
        Render.updatePrices(payload.changed);
      }
    });
  }

  /* ============================================================
     表格交互
     ============================================================ */
  function wireTable() {
    // 表头排序
    document.querySelectorAll('thead th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (view.sortKey === key) {
          view.sortDir = view.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          view.sortKey = key;
          view.sortDir = (key === 'base' || key === 'rank') ? 'asc' : 'desc';
        }
        // 更新表头指示
        document.querySelectorAll('thead th').forEach(t => {
          t.dataset.active = 'false';
          t.dataset.dir = '';
        });
        th.dataset.active = 'true';
        th.dataset.dir = view.sortDir;
        view.limit = CFG.MAX_ROWS_RENDERED;
        Render.renderTable(DataFeed.getList());
      });
    });
    // 初始排序指示
    const first = document.querySelector('thead th[data-sort="rank"]');
    if (first) { first.dataset.active = 'true'; first.dataset.dir = 'asc'; }

    // 搜索（防抖）
    let searchTimer = null;
    el.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        view.query = el.searchInput.value.trim().toUpperCase();
        view.limit = CFG.MAX_ROWS_RENDERED;
        Render.renderTable(DataFeed.getList());
      }, 180);
    });

    // 筛选
    el.filterSelect.addEventListener('change', () => {
      view.filter = el.filterSelect.value;
      view.limit = CFG.MAX_ROWS_RENDERED;
      Render.renderTable(DataFeed.getList());
    });

    // 加载更多
    el.loadMoreBtn.addEventListener('click', () => {
      view.limit += CFG.ROW_BATCH;
      Render.renderTable(DataFeed.getList());
    });

    // 滚动到底自动加载
    el.tableWrap.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = el.tableWrap;
      if (scrollHeight - scrollTop - clientHeight < 260) {
        if (!el.loadMoreBtn.hidden) {
          view.limit += CFG.ROW_BATCH;
          Render.renderTable(DataFeed.getList());
        }
      }
    }, { passive: true });

    // 行点击（事件委托）
    el.coinBody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-base]');
      if (!tr) return;
      Render.openDrawer(tr.dataset.base);
    });

    // 榜单 / 异动 点击
    el.leaderList.addEventListener('click', (e) => {
      const row = e.target.closest('[data-base]');
      if (row) Render.openDrawer(row.dataset.base);
    });

    el.signalGrid.addEventListener('click', (e) => {
      const row = e.target.closest('[data-base]');
      if (row) Render.openDrawer(row.dataset.base);
    });

    // 榜单切换
    el.leaderSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      el.leaderSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      view.leaderMode = btn.dataset.mode;
      if (lastMetrics) Render.renderLeader(lastMetrics);
    });
  }

  /* ============================================================
     抽屉交互
     ============================================================ */
  function wireDrawer() {
    el.drawerClose.addEventListener('click', () => Render.closeDrawer());
    el.drawerMask.addEventListener('click', () => Render.closeDrawer());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') Render.closeDrawer();
    });

    el.dWatch.addEventListener('click', () => {
      const base = el.dWatch.dataset.base;
      if (!base) return;
      if (typeof Watch === 'undefined') return;
      const r = Watch.toggle(null, base);
      Render.toast(r.message);
      syncWatch();
      el.dWatch.textContent = Watch.has(base) ? '移出自选' : '加入自选';
      Render.renderTable(DataFeed.getList());
    });
  }

  /* 自选库变更后同步视图与表格 */
  function syncWatch() {
    if (typeof Watch === 'undefined') return;
    view.watch = new Set(Watch.allBases());
    Render.renderTable(DataFeed.getList());
  }

  /* ============================================================
     顶栏交互
     ============================================================ */
  function wireTopbar() {
    document.getElementById('paletteBtn').addEventListener('click', () => {
      const cur = document.documentElement.dataset.palette;
      applyPalette(cur === 'global' ? 'cn' : 'global');
    });

    document.getElementById('densityBtn').addEventListener('click', () => {
      const cur = document.documentElement.dataset.density;
      applyDensity(cur === 'compact' ? 'comfort' : 'compact');
    });

    document.getElementById('refreshBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.classList.add('spin');
      try {
        await DataFeed.refresh();
        scheduleFullRender(true);
        Render.toast('行情快照已刷新');
      } catch (err) {
        Render.toast('刷新失败，请检查网络');
      } finally {
        setTimeout(() => btn.classList.remove('spin'), 600);
      }
    });
  }

  /* ============================================================
     窗口事件
     ============================================================ */
  function wireWindow() {
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (lastMetrics) {
          Render.redrawCharts(lastMetrics);
        }
      }, 220);
    });

    // 页面可见性：后台不再白跑流量，回前台补一次快照并恢复推送
    document.addEventListener('visibilitychange', () => {
      DataFeed.setVisible(!document.hidden);
      if (!document.hidden) DataFeed.refresh().then(() => scheduleFullRender(true));
    });
  }

  /* ============================================================
     启动
     ============================================================ */
  function boot() {
    // 恢复用户偏好
    applyPalette(lsGet(CFG.PALETTE_KEY, 'cn'));
    applyDensity(lsGet(CFG.DENSITY_KEY, 'comfort'));

    renderClock();
    setInterval(() => {
      renderClock();
      Render.renderStatus(DataFeed.getState());
    }, 1000);

    wireData();
    wireTable();
    wireDrawer();
    wireTopbar();
    wireWindow();

    DataFeed.start().catch(err => {
      console.error(err);
      Render.toast('数据源连接失败，请检查网络或代理');
    });

    // 兜底：若 6 秒后仍无数据，提示
    setTimeout(() => {
      if (DataFeed.getList().length === 0) {
        Render.renderStatus(DataFeed.getState());
        Render.toast('数据加载较慢，可能在等待网络代理…');
      }
    }, 6000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();

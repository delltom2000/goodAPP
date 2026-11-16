'use strict';
const HistoryChart = (() => {
  let coin, result, period = 'time', mode = 'line', count = 288, offset = 0, selected = -1, revision = 0;
  let root, canvas, status, detail, legend, source, indicator, averages, resize;
  const $ = id => document.getElementById(id);
  const colors = ['#e7edf5', '#f4b942', '#d966dd'];
  function ma(rows, size) {
    let sum = 0;
    return rows.map((p, i) => { sum += p.c; if (i >= size) sum -= rows[i - size].c; return i >= size - 1 ? sum / size : null; });
  }
  function ema(values, size) {
    let prev = values[0] || 0;
    return values.map(v => (prev = prev + 2 / (size + 1) * (v - prev)));
  }
  function macd(rows) {
    const values = rows.map(p => p.c), fast = ema(values, 12), slow = ema(values, 26);
    const dif = fast.map((v, i) => v - slow[i]), dea = ema(dif, 9);
    return { dif, dea, hist: dif.map((v, i) => 2 * (v - dea[i])) };
  }
  function rsi(rows, size = 14) {
    let gain = 0, loss = 0;
    return rows.map((p, i) => {
      if (!i) return null;
      const diff = p.c - rows[i - 1].c, up = Math.max(diff, 0), down = Math.max(-diff, 0);
      if (i <= size) { gain += up / size; loss += down / size; }
      else { gain = (gain * (size - 1) + up) / size; loss = (loss * (size - 1) + down) / size; }
      if (i < size) return null;
      return !loss ? (gain ? 100 : 50) : 100 - 100 / (1 + gain / loss);
    });
  }
  function date(t, time = false) {
    const d = new Date(t), pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` + (time ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '');
  }
  function init() {
    if (root) return;
    root = $('historyPanel'); canvas = $('dChart'); status = $('chartStatus'); detail = $('chartDetail'); legend = $('chartLegend');
    source = $('chartSource'); indicator = $('chartIndicator'); averages = $('chartMA');
    root.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
      period = button.dataset.period; mode = History.PERIODS[period].line ? 'line' : 'candle'; count = History.PERIODS[period].line ? History.PERIODS[period].limit : Math.min(120, History.PERIODS[period].limit); offset = 0; selected = -1; load();
    }));
    root.querySelectorAll('[data-chart-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.chartMode; controls(); draw(); }));
    source.addEventListener('change', () => load(true));
    indicator.addEventListener('change', draw); averages.addEventListener('change', draw);
    $('chartRetry').addEventListener('click', () => load(true));
    root.querySelectorAll('[data-chart-action]').forEach(button => button.addEventListener('click', () => {
      const action = button.dataset.chartAction;
      if (action === 'in') count = Math.max(20, Math.round(count * .7));
      if (action === 'out') count = Math.min(result?.points.length || 300, Math.round(count / .7));
      if (action === 'left') offset += Math.round(count / 2);
      if (action === 'right') offset -= Math.round(count / 2);
      selected = -1; draw();
    }));
    canvas.addEventListener('pointermove', e => {
      const rect = canvas.getBoundingClientRect();
      const n = Math.min(count, result?.points.length || 0);
      selected = Math.min(n - 1, Math.max(0, Math.floor((e.clientX - rect.left - 8) / Math.max(1, rect.width - 62) * n))); draw();
    });
    canvas.addEventListener('pointerleave', () => { selected = -1; draw(); });
    canvas.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); selected = Math.max(0, Math.min(Math.min(count, result?.points.length || 0) - 1, (selected < 0 ? 0 : selected) + (e.key === 'ArrowLeft' ? -1 : 1))); draw();
    });
    resize = new ResizeObserver(() => { if (!root.closest('[hidden]')) draw(); }); resize.observe(root);
    setInterval(() => { if (coin && !document.hidden) load(true); }, 60000);
  }
  function controls() {
    root.querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.period === period)));
    root.querySelectorAll('[data-chart-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.chartMode === mode)));
  }
  function show(next) {
    init();
    if (coin?.base !== next.base) { offset = 0; selected = -1; }
    coin = next; controls(); load();
  }
  function describe(value, loading = false) {
    $('chartDiagnostics').textContent = (value?.errors || []).map(e => `${e.source} (${e.host}): ${e.error}`).join('\n') || (loading ? '正在连接可用来源' : '没有已记录的请求错误');
    if (!value?.points?.length) { status.textContent = loading ? '正在尝试多路行情源…' : '所有来源暂不可用，尚无本地历史缓存'; $('chartTimestamp').textContent = ''; status.dataset.stale = 'true'; return; }
    const label = History.LABELS[value.source];
    const old = value.cached || value.stale;
    status.dataset.stale = String(old);
    status.textContent = `${old ? '历史留存' : '在线数据'} · ${label} · ${value.points.length} 根${value.aggregated ? ' · 日线合成月K' : ''}${loading ? ' · 正在更新…' : ''}`;
    $('chartTimestamp').textContent = `最后一根起点 ${date(value.asOf, true)} · 获取 ${date(value.fetchedAt, true)} · 本机时区`;
    status.title = (value.errors || []).map(e => `${e.source} (${e.host}): ${e.error}`).join('\n');
    if (!loading && source.value !== 'auto' && value.source !== source.value) status.textContent += ' · 指定源失败，保留原缓存';
  }
  async function load(force = false) {
    const id = ++revision, current = coin, currentPeriod = period;
    controls();
    result = History.peek(current.base, period); describe(result, true); draw();
    try {
      const next = await History.load(current, currentPeriod, source.value, force);
      if (id !== revision) return;
      result = next; describe(result); draw();
    } catch (error) {
      if (id !== revision) return;
      describe(result); if (!result) status.textContent = '历史数据读取失败，请重试';
    }
  }
  function draw() {
    if (!canvas) return;
    const w = Math.max(root.clientWidth - 24, 100), h = 330, dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = h * dpr; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const all = result?.points || [];
    if (all.length < 2) { ctx.fillStyle = '#8793a3'; ctx.font = '12px system-ui'; ctx.fillText('等待可用的历史行情', 16, 100); detail.textContent = '暂无 OHLCV 数据'; legend.textContent = ''; $('chartWindow').textContent = ''; canvas.setAttribute('aria-label', `${coin?.base || ''} ${History.PERIODS[period].label}：暂无历史行情`); return; }
    offset = Math.min(Math.max(0, offset), Math.max(0, all.length - Math.min(count, all.length)));
    const end = all.length - offset, start = Math.max(0, end - count), rows = all.slice(start, end), n = rows.length;
    const up = getComputedStyle(document.documentElement).getPropertyValue('--up').trim() || '#f6465d';
    const down = getComputedStyle(document.documentElement).getPropertyValue('--down').trim() || '#0ecb81';
    const width = w - 62, top = 16, bottom = 220, lowerTop = 253, lowerBottom = 307;
    const min = Math.min(...rows.map(p => mode === 'candle' ? p.l : p.c)), max = Math.max(...rows.map(p => mode === 'candle' ? p.h : p.c));
    const span = max - min || max * .01, lo = min - span * .07, hi = max + span * .07;
    const x = i => 8 + (i + .5) / n * width, y = v => top + (hi - v) / (hi - lo) * (bottom - top);
    const text = (s, a, b, color = '#8290a3', align = 'left') => { ctx.fillStyle = color; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = align; ctx.fillText(s, a, b); };
    const line = (values, color, scale = y) => {
      ctx.beginPath(); let started = false;
      values.forEach((v, i) => { if (v == null || !Number.isFinite(v)) { started = false; return; } if (!started) ctx.moveTo(x(i), scale(v)); else ctx.lineTo(x(i), scale(v)); started = true; });
      ctx.strokeStyle = color; ctx.lineWidth = 1.25; ctx.stroke();
    };
    ctx.strokeStyle = '#ffffff0c'; ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) { const yy = top + (bottom - top) * i / 4; ctx.beginPath(); ctx.moveTo(8, yy); ctx.lineTo(width + 8, yy); ctx.stroke(); text(fmtPrice(hi - (hi - lo) * i / 4), w - 2, yy + 3, undefined, 'right'); }
    ctx.save(); ctx.beginPath(); ctx.rect(7, top, width + 2, bottom - top); ctx.clip();
    if (mode === 'candle') rows.forEach((p, i) => {
      const color = p.c >= p.o ? up : down, bw = Math.max(1, width / n * .65);
      ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x(i), y(p.h)); ctx.lineTo(x(i), y(p.l)); ctx.stroke();
      ctx.fillStyle = color; ctx.fillRect(x(i) - bw / 2, Math.min(y(p.o), y(p.c)), bw, Math.max(1, Math.abs(y(p.o) - y(p.c))));
    });
    else {
      const color = rows[n - 1].c >= rows[0].c ? up : down;
      ctx.beginPath(); ctx.moveTo(x(0), bottom); rows.forEach((p, i) => ctx.lineTo(x(i), y(p.c))); ctx.lineTo(x(n - 1), bottom); ctx.closePath();
      const grad = ctx.createLinearGradient(0, top, 0, bottom); grad.addColorStop(0, color + '40'); grad.addColorStop(1, color + '00'); ctx.fillStyle = grad; ctx.fill(); line(rows.map(p => p.c), color);
    }
    const means = [5, 10, 20].map(k => ma(all, k));
    if (averages.checked) means.forEach((values, i) => line(values.slice(start, end), colors[i]));
    ctx.restore();
    const sel = selected < 0 ? n - 1 : Math.min(n - 1, selected), p = rows[sel];
    detail.textContent = `${date(p.t, ['time', 'five', 'm15', 'hour'].includes(period))}  开 ${fmtPrice(p.o)}  高 ${fmtPrice(p.h)}  低 ${fmtPrice(p.l)}  收 ${fmtPrice(p.c)}`;
    legend.replaceChildren();
    if (averages.checked) means.forEach((values, i) => { const item = document.createElement('span'); item.style.color = colors[i]; const v = values[start + sel]; item.textContent = `MA${[5, 10, 20][i]} ${v == null ? '--' : fmtPrice(v)}`; legend.append(item); });
    if (indicator.value === 'volume') {
      const peak = Math.max(...rows.map(p => p.v), 1);
      rows.forEach((p, i) => { ctx.fillStyle = p.c >= p.o ? up : down; const height = p.v / peak * (lowerBottom - lowerTop); ctx.fillRect(x(i) - width / n * .32, lowerBottom - height, Math.max(1, width / n * .64), height); });
      text(`VOL ${fmtNum(p.v)} ${coin.base}`, 8, 243);
    } else if (indicator.value === 'macd') {
      const m = macd(all), dif = m.dif.slice(start, end), dea = m.dea.slice(start, end), hist = m.hist.slice(start, end);
      const peak = Math.max(...[...dif, ...dea, ...hist].map(Math.abs), 1e-10), sy = v => (lowerTop + lowerBottom) / 2 - v / peak * 25;
      hist.forEach((v, i) => { ctx.fillStyle = v >= 0 ? up : down; ctx.fillRect(x(i), Math.min(sy(0), sy(v)), Math.max(1, width / n * .6), Math.max(1, Math.abs(sy(v) - sy(0)))); });
      line(dif, colors[0], sy); line(dea, colors[1], sy); text('MACD (12,26,9) · DIF / DEA', 8, 243);
    } else {
      const values = rsi(all).slice(start, end), sy = v => lowerBottom - v / 100 * (lowerBottom - lowerTop);
      [30, 70].forEach(v => { ctx.strokeStyle = '#ffffff20'; ctx.beginPath(); ctx.moveTo(8, sy(v)); ctx.lineTo(width + 8, sy(v)); ctx.stroke(); text(String(v), w - 2, sy(v) + 3, undefined, 'right'); });
      line(values, colors[2], sy); text(`RSI (14) ${values[sel]?.toFixed(2) ?? '--'}`, 8, 243);
    }
    if (selected >= 0) {
      ctx.setLineDash([3, 3]); ctx.strokeStyle = '#9da8b8'; ctx.beginPath(); ctx.moveTo(x(sel), top); ctx.lineTo(x(sel), lowerBottom); ctx.moveTo(8, y(p.c)); ctx.lineTo(width + 8, y(p.c)); ctx.stroke(); ctx.setLineDash([]);
    }
    text(date(rows[0].t), 8, 325); text(date(rows[n - 1].t), width + 8, 325, undefined, 'right');
    canvas.setAttribute('aria-label', `${coin.base} ${History.PERIODS[period].label}，${History.LABELS[result.source]}，显示 ${n} 根。${detail.textContent}。左右键查看数据。`);
    $('chartWindow').textContent = `${start + 1}–${end} / ${all.length}`;
  }
  function close() { revision++; coin = null; }
  return { show, close, redraw: draw, ma, macd, rsi };
})();

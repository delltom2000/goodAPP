/* ==========================================================================
   i18n — 中英文切换
   设计取舍：以「中文原文」作字典键，DOM 里的文本节点按原文匹配替换，
   这样不用给几百个元素加 data-i18n 属性，渲染层也不用改写成 t('key')。
   带变量的长句（评分理由、说明正文）不做翻译，保持中文原文。
   ========================================================================== */
(function () {
  'use strict';

  var EN = {
    /* ---------- 通用 / 导航 ---------- */
    '币市脉搏': 'Coin Pulse',
    '市场脉搏': 'Markets',
    '新币雷达': 'New Coins',
    'BINANCE · 成交额 TOP 500 实时分析': 'BINANCE · TOP 500 BY VOLUME · LIVE',
    '最近上链项目的知识库与可靠性评分': 'Reliability scores for recently listed projects',
    '正在接入行情…': 'Connecting to feed…',
    '北京时间': 'BJT',
    '红涨': 'Red↑',
    '绿涨': 'Green↑',
    '紧凑': 'Dense',
    '舒适': 'Comfy',
    '刷新': 'Refresh',
    '关闭': 'Close',
    '重试': 'Retry',
    '自选': 'Watch',
    '自选股': 'Watch',
    '加入自选': 'Add to watchlist',
    '移出自选': 'Remove',
    '打开自选股列表': 'Open watchlist',
    '切换涨跌配色': 'Color scheme',
    '切换涨跌配色（当前：红涨绿跌）': 'Color scheme (red = up)',
    '切换表格密度': 'Table density',
    '重新拉取快照': 'Reload snapshot',
    '重新同步数据': 'Re-sync',
    '应用切换': 'Switch app',
    '搜索': 'Search',
    '筛选': 'Filter',

    /* ---------- 主站 ---------- */
    '市场总览': 'Market overview',
    '市场宽度与涨跌分布': 'Market Breadth',
    'TOP 500 等权统计': 'TOP 500 equal-weighted',
    '上涨': 'Up',
    '下跌': 'Down',
    '资金流向': 'Capital Flow',
    '成交额归集': 'by volume',
    '空头主导': 'Bears',
    '多头主导': 'Bulls',
    '领涨 / 领跌': 'Top Gainers / Losers',
    '成交额 > 500 万': 'Volume > $5M',
    '涨幅': 'Gainers',
    '跌幅': 'Losers',
    '异动雷达': 'Anomaly Radar',
    '放量 · 急动 · 破位 · 振幅异常': 'Volume · Spike · Breakdown · Range',
    '全量行情': 'All Markets',
    '全部币种': 'All coins',
    '仅上涨': 'Gainers only',
    '仅下跌': 'Losers only',
    '高换手': 'High turnover',
    '高振幅': 'High volatility',
    '币种': 'Coin',
    '最新价': 'Price',
    '24h 涨跌': '24h %',
    '24h 振幅': '24h Range',
    '24h 成交额': '24h Volume',
    '市值': 'Market Cap',
    '换手率': 'Turnover',
    '走势': 'Trend',
    '没有匹配的币种': 'No matching coins',
    '显示更多': 'Show more',
    '搜索币种 / 名称': 'Search coin / name',
    '币种详情': 'Coin details',
    '池内总成交额 · 24h': '24h Volume',
    '涨跌家数': 'Adv / Dec',
    '成交额加权涨跌': 'Vol-weighted Change',
    '市场情绪': 'Sentiment',
    '净资金流（估算）': 'Net Flow (est.)',
    '平均振幅': 'Avg. Range',
    '池内总市值': 'Market Cap',
    '中位换手率': 'Median Turnover',
    '暂无数据': 'No data',
    '当前无显著异动': 'No notable anomalies',
    '走势数据暂不可用': 'Trend unavailable',
    '加载走势…': 'Loading…',
    '实时推送': 'Live',
    '正在建立实时连接…': 'Connecting…',
    '轮询模式 · 5 秒刷新': 'Polling · 5s',
    '数据源连接失败，请检查网络或代理': 'Feed failed. Check your network.',
    '行情快照已刷新': 'Snapshot refreshed',
    '刷新失败，请检查网络': 'Refresh failed. Check network.',
    '数据加载较慢，可能在等待网络代理…': 'Still loading — network may be slow…',

    /* ---------- 新币页 ---------- */
    '等待同步…': 'Waiting…',
    '正在统计…': 'Calculating…',
    '评分模型': 'Model',
    '新币评分榜': 'New Coin Ranking',
    '全部评级': 'All grades',
    '仅 A 级': 'A only',
    '仅 B 级': 'B only',
    'A + B 级': 'A + B',
    '风险提示': 'Risk flags',
    '全部交易所': 'All exchanges',
    '上了 Binance': 'On Binance',
    '上了 OKX': 'On OKX',
    '上了 Bybit': 'On Bybit',
    '≥3 家交易所': '≥3 venues',
    '全部项目': 'All projects',
    '仅自选': 'Watchlist',
    '项目': 'Project',
    '上线': 'Listed',
    '价格': 'Price',
    '成交额': 'Volume',
    '交易所': 'Venues',
    '可靠性': 'Reliability',
    '潜力': 'Upside',
    '综合': 'Overall',
    '评级': 'Grade',
    '正在抓取各交易所上线数据…': 'Fetching listings…',
    '← 左右滑动查看全部列 →': '← Swipe for more →',
    '评分基于公开数据，不构成投资建议': 'Public data only. Not investment advice.',
    '知识库': 'Knowledge',
    '未初始化': 'Not ready',
    '建档项目': 'Projects',
    '快照记录': 'Snapshots',
    '积累天数': 'Days tracked',
    '市值覆盖': 'MC coverage',
    '自选库': 'Watchlist',
    '＋ 新建': '+ New',
    '导出': 'Export',
    '导入': 'Import',
    '可靠性因子': 'Reliability',
    '潜力因子': 'Upside',
    '各交易所报价': 'Exchange quotes',
    '知识库记录': 'KB records',
    '在右侧管理目录': 'Manage on the right',
    '＋ 新建目录': '+ New folder',
    '上线时间窗口': 'Listing window',
    '查看评分模型说明': 'View model',
    '新币总览': 'New coin overview',
    '搜索币种 / 名称…': 'Search coin / name…',
    '按评级筛选': 'Filter by grade',
    '按交易所筛选': 'Filter by exchange',
    '按自选筛选': 'Filter by watchlist',
    '新建自选目录': 'New watchlist folder',
    '项目详情': 'Project details',
    '评分模型说明': 'Scoring Model',
    '窗口内项目': 'In window',
    'A / B 级': 'Grade A / B',
    '中位成交额': 'Median Volume',
    '中位上线时长': 'Median Age',
    '综合分': 'Overall',
    '记录最高价': 'Peak',
    '24h 高点': '24h High',
    '上线时间': 'Listed',
    '首次观测价': 'First seen',
    '较首次观测': 'vs first',
    '较记录高点': 'vs peak',
    '较 24h 高点': 'vs 24h high',
    '移除': 'Remove',
    '重命名': 'Rename',
    '删除目录': 'Delete folder',
    '还没有自选': 'No coins',
    '不在当前窗口': 'Outside window',
    '现货': 'Spot',
    '未收录': 'Not tracked',
    '空目录': 'Empty',
    '评分不可用': 'Score n/a',
    '无报价数据': 'No quotes',
    '缺数据': 'Missing',
    '快照记录': 'Snapshots',

    /* ---------- 评分档位 ---------- */
    'A 级': 'Grade A',
    'B 级': 'Grade B',
    'C 级': 'Grade C',
    'D 级': 'Grade D',
    '稳健成长': 'Steady growth',
    '高弹性': 'High upside',
    '高风险投机': 'High-risk speculation',
    '相对稳健': 'Relatively solid',
    '建议规避': 'Avoid',
    '观察': 'Watch',
    '为什么是这个分': 'Why this score',
    '活下来、不作恶': 'Survive & behave',
    '交易所背书': 'Exchange backing',
    '官方风险信号': 'Official risk flags',
    '流动性深度': 'Liquidity depth',
    '交易持续性': 'Persistence',
    '跨所一致性': 'Cross-venue consistency',
    '价格稳定性': 'Price stability',
    '资金关注度': 'Capital attention',
    '价格动量': 'Momentum',
    '市值空间': 'MC headroom',
    '上线新鲜度': 'Freshness',
    '赛道与叙事': 'Narrative',
    '回撤与位置': 'Drawdown',
    '模型的实测区分度': 'Empirical separation',
    '已知局限': 'Known limits',
    '不是涨跌预测。': 'Not a price forecast.',

    /* ---------- 状态与副标签 ---------- */
    '极度恐慌 · 普跌格局': 'Extreme fear · broad selloff',
    '偏冷 · 空头占优': 'Cool · bears lead',
    '中性 · 多空均衡': 'Neutral · balanced',
    '偏暖 · 多头占优': 'Warm · bulls lead',
    '极度贪婪 · 普涨格局': 'Extreme greed · broad rally',
    '日成交额 / 市值': 'Volume / MC',
    '上涨币种成交额': 'Advancing vol.',
    '下跌币种成交额': 'Declining vol.',
    '净流入（估算）': 'Net inflow (est.)',
    '成交额池内中位': 'Pool median',
    '通过可靠性门槛': 'Passed reliability bar',
    '24 小时合计': '24h total',
    '含警示信号': 'With warning flags',
    '正在同步各交易所…': 'Syncing exchanges…',
    '正在重新抓取…': 'Refetching…',
    '已同步': 'Synced',
    '同步失败：': 'Sync failed: ',
    '先看这个': 'Start here',

    /* ---------- 信号标签与图表碎片 ---------- */
    '急涨': 'Spike ↑',
    '急跌': 'Spike ↓',
    '放量': 'Volume surge',
    '异动': 'Unusual',
    '逼近日高': 'Near high',
    '逼近日低': 'Near low',
    '平盘': 'Flat',
    '上涨占比': 'Up',
    '成交额集中度': 'Vol. concentration',
    '大市值 >$10B': 'Large >$10B',
    '中市值 $1-10B': 'Mid $1-10B',
    '小市值 <$1B': 'Small <$1B',
    '市值未知': 'MC n/a',
    '窗口内符合条件的真实加密新项目': 'Real new projects in window',
    '首次运行，尚无历史快照。「交易持续性」和「回撤位置」按中性计分，明天再打开就会开始累积。':
      'First run — no snapshots yet. Persistence and drawdown are scored neutral until tomorrow.',
    '个': ''
  };

  /* 带数字的模板句：正则整串匹配后替换，顺序从特化到泛化 */
  var PATTERNS = [
    [/^(\d+) 个币 · 当前显示 (\d+) \/ (\d+)$/, '$1 coins · showing $2 / $3'],
    [/^显示更多（剩余 (\d+) 个）$/, 'Show more ($1 left)'],
    [/^已积累 (\d+) 天快照。[\s\S]*$/, 'Tracking for $1 days. Persistence is now live.'],
    [/^24h ([+-]?[\d.]+%) · 额 (.+)$/, '24h $1 · Vol $2'],
    [/^振幅 ([\d.]+%) · 额 (.+)$/, 'Range $1 · Vol $2'],
    [/^位于日高 ([\d.]+%) · 额 (.+)$/, 'Near high $1 · Vol $2'],
    [/^位于日低 ([\d.]+%) · 额 (.+)$/, 'Near low $1 · Vol $2'],
    [/^换手 ([\d.]+%)$/, 'Turnover $1'],
    [/^位于日高 ([\d.]+%)$/, 'Near high $1'],
    [/^位于日低 ([\d.]+%)$/, 'Near low $1'],
    [/^前 10 占 (\d+(?:\.\d+)?)%$/, 'Top 10 $1%'],
    [/^平盘 (\d+) · 上涨占比 (\d+(?:\.\d+)?)%$/, 'Flat $1 · Up $2%'],
    [/^等权 (.+?) · 中位 (.+)$/, 'EW $1 · Med $2'],
    [/^多头成交占比 (.+)$/, 'Bull vol $1'],
    [/^窗口内符合条件的真实加密新项目 (\d+) 个$/, '$1 real projects in window'],
    [/^(\d+) 个在 (\d+) 天内$/, '$1 within $2d'],
    [/^上限 (\d+)$/, 'Cap $1'],
    [/^(\d+(?:\.\d+)?)% 覆盖率$/, '$1% coverage'],
    [/^实时推送 · (\d{2}:\d{2}:\d{2})$/, 'Live · $1'],
    [/^实时推送 · (\d{2}:\d{2})$/, 'Live · $1'],
    [/^离线数据 · (\d{2}:\d{2})$/, 'Offline · $1'],
    [/^已同步 · (\d{2}:\d{2})$/, 'Synced · $1'],
    [/^轮询模式 · (\d{2}:\d{2})$/, 'Polling · $1'],
    [/^(\d+) 个币种 · (\d+) 个目录$/, '$1 coins · $2 folders'],
    [/^(\d+) \/ (\d+) 目录$/, '$1 / $2 folders'],
    [/^覆盖 (\d+)\/(\d+) 个币$/, '$1/$2 coins'],
    [/^平盘 (\d+)$/, 'Flat $1'],
    [/^中位 (.+)$/, 'Median $1'],
    [/^(\d+(?:\.\d+)?) 天$/, '$1d'],
    [/^(\d+) 个币$/, '$1 coins'],
    [/^(\d+) 个$/, '$1']
  ];

  var KEY = 'cp.lang';
  var lang = 'zh';
  try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'zh'; } catch (e) {}

  var listeners = [];

  function has(k) { return Object.prototype.hasOwnProperty.call(EN, k); }

  var ZH_RE = /[\u4e00-\u9fa5]/;

  function patternHit(key) {
    // 纯数字/英文的节点占绝大多数，先短路，避免每个都跑一遍正则
    if (!ZH_RE.test(key)) return null;
    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i][0].test(key)) return key.replace(PATTERNS[i][0], PATTERNS[i][1]);
    }
    return null;
  }
  function isEn() { return lang === 'en'; }
  function t(zh) { return lang === 'en' && has(zh) ? EN[zh] : zh; }
  function pick(zh, en) { return lang === 'en' ? en : zh; }

  /** 把 root 子树里的中文文本替换成英文；原文存在节点上，切回时能还原 */
  function applyText(root) {
    if (lang !== 'en' || !root) return;
    var doc = root.ownerDocument || document;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var raw = node.nodeValue;
      if (!raw) continue;
      var key = raw.trim();
      if (!key) continue;
      var out = has(key) ? EN[key] : patternHit(key);
      if (out == null) continue;
      if (node.__zh === undefined) node.__zh = raw;
      node.nodeValue = raw.replace(key, out);
    }
    if (root.querySelectorAll) {
      var els = root.querySelectorAll('[title],[placeholder],[aria-label]');
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        swapAttr(el, 'title');
        swapAttr(el, 'placeholder');
        swapAttr(el, 'aria-label');
      }
    }
  }

  function swapAttr(el, attr) {
    var v = el.getAttribute(attr);
    if (!v) return;
    var k = v.trim();
    if (!has(k)) return;
    if (el['__zh_' + attr] === undefined) el['__zh_' + attr] = v;
    el.setAttribute(attr, EN[k]);
  }

  function restoreText(root) {
    if (!root) return;
    var doc = root.ownerDocument || document;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var n;
    while ((n = walker.nextNode())) {
      if (n.__zh !== undefined) n.nodeValue = n.__zh;
    }
    if (root.querySelectorAll) {
      var els = root.querySelectorAll('[title],[placeholder],[aria-label]');
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        ['title', 'placeholder', 'aria-label'].forEach(function (attr) {
          if (el['__zh_' + attr] !== undefined) {
            el.setAttribute(attr, el['__zh_' + attr]);
            el['__zh_' + attr] = undefined;
          }
        });
      }
    }
  }

  /** 切换语言并广播，页面各自重渲染 */
  function setLang(next) {
    var v = next === 'en' ? 'en' : 'zh';
    if (v === lang) return;
    lang = v;
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    syncButtons();
    if (lang === 'en') {
      applyText(document.body);
    } else {
      restoreText(document.body);
    }
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (e) {}
    }
  }

  function toggle() { setLang(lang === 'en' ? 'zh' : 'en'); }

  function onChange(fn) { listeners.push(fn); }

  /** 顶部按钮文案：英文模式显示「中」表示可切回中文 */
  function syncButtons() {
    var btns = document.querySelectorAll('[data-lang-toggle]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.textContent = lang === 'en' ? '中' : 'EN';
      b.title = lang === 'en' ? '切换到中文' : 'Switch to English';
      b.setAttribute('aria-label', b.title);
      b.classList.toggle('lang-on', lang === 'en');
    }
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
  }

  function bind() {
    syncButtons();
    var btns = document.querySelectorAll('[data-lang-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', toggle);
    }
    if (lang === 'en') applyText(document.body);
  }

  window.I18N = {
    t: t, pick: pick, isEn: isEn,
    apply: applyText, restore: restoreText,
    setLang: setLang, toggle: toggle, onChange: onChange,
    get lang() { return lang; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

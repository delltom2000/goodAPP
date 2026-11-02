/* ============================================================
   snap.js — 行情快照本地留存

   目的：接口拉不到时不要让用户对着空页面。每次成功同步后存一份精简快照，
   下次启动或同步失败时先把它铺出来，并在顶栏注明「离线数据 · HH:MM」。

   注意：
   - 只存渲染需要的字段，体积控制在百 KB 级
   - 写入做节流，避免每次轮询都写 localStorage 造成卡顿
   - 读写全程 try/catch，配额不足或隐私模式下静默降级
   ============================================================ */
'use strict';

const Snap = (() => {
  const VERSION = 1;

  function save(key, data, at) {
    try {
      localStorage.setItem(key, JSON.stringify({
        v: VERSION,
        at: at || Date.now(),
        data,
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 读出快照；超过 maxAge 视为无效 */
  function load(key, maxAge) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || o.v !== VERSION || !o.at || !o.data) return null;
      if (maxAge && Date.now() - o.at > maxAge) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function clear(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
  }

  return { save, load, clear };
})();

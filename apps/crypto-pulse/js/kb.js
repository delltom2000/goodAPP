/* ==========================================================================
   KB — 新币知识库（IndexedDB）
   三张表：
     projects  : 项目档案（上线时间、交易所覆盖、官方标签、首次观测…）
     snaps     : 每日快照（价格 / 成交额 / 市值），用于计算趋势与稳定性
     meta      : 键值元信息（最后同步时间、评分模型版本）
   浏览器不支持 IndexedDB 时退化为内存存储（不持久化，但功能可用）。
   ========================================================================== */
const KB = (() => {
  'use strict';

  const DB_NAME = 'cp.newcoin.kb';
  const DB_VER = 1;
  const ST_PROJECTS = 'projects';
  const ST_SNAPS = 'snaps';
  const ST_META = 'meta';
  const SNAP_KEEP_DAYS = 180;   // 快照保留天数

  let dbp = null;
  let memory = null;            // 降级模式

  /* ---------------- 打开数据库 ---------------- */

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        memory = { projects: new Map(), snaps: new Map(), meta: new Map() };
        resolve(null);
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        memory = { projects: new Map(), snaps: new Map(), meta: new Map() };
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ST_PROJECTS)) {
          const s = db.createObjectStore(ST_PROJECTS, { keyPath: 'base' });
          s.createIndex('firstSeen', 'firstSeen');
          s.createIndex('listedAt', 'listedAt');
        }
        if (!db.objectStoreNames.contains(ST_SNAPS)) {
          const s = db.createObjectStore(ST_SNAPS, { keyPath: 'key' });
          s.createIndex('base', 'base');
          s.createIndex('day', 'day');
        }
        if (!db.objectStoreNames.contains(ST_META)) {
          db.createObjectStore(ST_META, { keyPath: 'k' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        memory = { projects: new Map(), snaps: new Map(), meta: new Map() };
        resolve(null);
      };
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(db => {
      if (!db) return fn(null);
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let out;
        try { out = fn(s); } catch (e) { reject(e); return; }
        t.oncomplete = () => resolve(out && out.__req ? out.__req.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    });
  }

  function req(r) {
    return { __req: r };
  }

  function dayKey(ts = Date.now()) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------------- 项目档案 ---------------- */

  async function getProject(base) {
    const b = String(base || '').toUpperCase();
    if (!b) return null;
    if (memory) return memory.projects.get(b) || null;
    return tx(ST_PROJECTS, 'readonly', s => req(s.get(b)));
  }

  async function getAllProjects() {
    if (memory) return [...memory.projects.values()];
    return tx(ST_PROJECTS, 'readonly', s => req(s.getAll()));
  }

  /**
   * 写入/合并一个项目档案。
   * 只覆盖传入的字段，保留已有历史（firstSeen、首日成交额等不会被后来的数据冲掉）。
   */
  async function upsertProject(patch) {
    const b = String(patch.base || '').toUpperCase();
    if (!b) return null;
    const existing = await getProject(b);
    const now = Date.now();
    const prev = existing || {};
    const merged = {
      base: b,
      name: patch.name || prev.name || '',
      image: patch.image || prev.image || '',
      cgId: patch.cgId || prev.cgId || '',
      // 上线时间：取已记录的最早值，避免不同交易所来回覆盖
      listedAt: prev.listedAt && patch.listedAt ? Math.min(prev.listedAt, patch.listedAt) : (patch.listedAt || prev.listedAt || 0),
      exchanges: { ...(prev.exchanges || {}), ...(patch.exchanges || {}) },
      binanceTags: patch.binanceTags || prev.binanceTags || [],
      firstSeen: prev.firstSeen || now,
      lastSeen: now,
      // 首次观测到的基准数据，用于计算"上线以来表现"
      firstPrice: prev.firstPrice || patch.price || 0,
      firstMcap: prev.firstMcap || patch.marketCap || 0,
      firstQv: prev.firstQv || patch.quoteVolume || 0,
      // 最新值
      price: patch.price != null ? patch.price : prev.price || 0,
      quoteVolume: patch.quoteVolume != null ? patch.quoteVolume : prev.quoteVolume || 0,
      marketCap: patch.marketCap != null ? patch.marketCap : prev.marketCap || 0,
      circulating: patch.circulating != null ? patch.circulating : prev.circulating || 0,
      change24h: patch.change24h != null ? patch.change24h : prev.change24h || 0,
      change7d: patch.change7d != null ? patch.change7d : prev.change7d || 0,
      athChange: patch.athChange != null ? patch.athChange : prev.athChange || 0,
      category: patch.category || prev.category || '',
      score: patch.score || prev.score || null,
      snapDays: prev.snapDays || 0,
      updatedAt: now,
    };
    if (memory) { memory.projects.set(b, merged); return merged; }
    await tx(ST_PROJECTS, 'readwrite', s => s.put(merged));
    return merged;
  }

  async function bulkUpsertProjects(list) {
    if (!Array.isArray(list) || !list.length) return 0;
    let n = 0;
    for (const p of list) {
      await upsertProject(p);
      n++;
    }
    return n;
  }

  /* ---------------- 每日快照 ---------------- */

  async function putSnap(base, data, ts = Date.now()) {
    const b = String(base || '').toUpperCase();
    if (!b) return;
    const day = dayKey(ts);
    const key = b + '@' + day;
    const row = {
      key, base: b, day, ts,
      price: data.price || 0,
      qv: data.quoteVolume || 0,
      mcap: data.marketCap || 0,
      chg: data.change24h || 0,
    };
    if (memory) { memory.snaps.set(key, row); return; }
    await tx(ST_SNAPS, 'readwrite', s => s.put(row));
  }

  async function bulkPutSnaps(rows, ts = Date.now()) {
    if (!Array.isArray(rows) || !rows.length) return 0;
    const day = dayKey(ts);
    const list = rows.map(r => ({
      key: String(r.base).toUpperCase() + '@' + day,
      base: String(r.base).toUpperCase(),
      day, ts,
      price: r.price || 0,
      qv: r.quoteVolume || 0,
      mcap: r.marketCap || 0,
      chg: r.change24h || 0,
    }));
    if (memory) { for (const r of list) memory.snaps.set(r.key, r); return list.length; }
    return tx(ST_SNAPS, 'readwrite', s => { for (const r of list) s.put(r); return list.length; });
  }

  async function getSnaps(base) {
    const b = String(base || '').toUpperCase();
    if (memory) return [...memory.snaps.values()].filter(r => r.base === b).sort((a, c) => a.ts - c.ts);
    return tx(ST_SNAPS, 'readonly', s => {
      const idx = s.index('base');
      return req(idx.getAll(b));
    }).then(rows => (rows || []).sort((a, c) => a.ts - c.ts));
  }

  async function countSnaps(base) {
    const rows = await getSnaps(base);
    return rows.length;
  }

  /** 清理超过保留期的快照 */
  async function pruneSnaps() {
    const cut = Date.now() - SNAP_KEEP_DAYS * 864e5;
    if (memory) {
      for (const [k, v] of memory.snaps) if (v.ts < cut) memory.snaps.delete(k);
      return 0;
    }
    return tx(ST_SNAPS, 'readwrite', s => {
      let n = 0;
      const r = s.index('day').openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return;
        if (c.value.ts < cut) { c.delete(); n++; }
        c.continue();
      };
      return n;
    });
  }

  /* ---------------- 元信息 ---------------- */

  async function getMeta(k) {
    if (memory) { const m = memory.meta.get(k); return m ? m.v : null; }
    const row = await tx(ST_META, 'readonly', s => req(s.get(k)));
    return row ? row.v : null;
  }

  async function setMeta(k, v) {
    if (memory) { memory.meta.set(k, { k, v }); return; }
    await tx(ST_META, 'readwrite', s => s.put({ k, v }));
  }

  /* ---------------- 统计 ---------------- */

  async function stats() {
    const projects = await getAllProjects();
    let snaps = 0;
    if (memory) snaps = memory.snaps.size;
    else snaps = await tx(ST_SNAPS, 'readonly', s => req(s.count()));
    return {
      projects: projects.length,
      snaps: snaps || 0,
      lastSync: await getMeta('lastSync'),
      modelVersion: await getMeta('modelVersion'),
      storage: memory ? 'memory' : 'indexeddb',
    };
  }

  async function clearAll() {
    if (memory) { memory.projects.clear(); memory.snaps.clear(); memory.meta.clear(); return; }
    await tx(ST_PROJECTS, 'readwrite', s => s.clear());
    await tx(ST_SNAPS, 'readwrite', s => s.clear());
    await tx(ST_META, 'readwrite', s => s.clear());
  }

  return {
    open, getProject, getAllProjects, upsertProject, bulkUpsertProjects,
    putSnap, bulkPutSnaps, getSnaps, countSnaps, pruneSnaps,
    getMeta, setMeta, stats, clearAll, dayKey,
    SNAP_KEEP_DAYS,
  };
})();

if (typeof window !== 'undefined') window.KB = KB;

/* ==========================================================================
   Watch — 多目录自选库
   最多 10 个目录，每个目录最多 50 个币种。
   存储于 localStorage: cp.watch.v2
   兼容旧版单列表 cp.watch.v1（数组），首次读取时自动迁移。
   ========================================================================== */
const Watch = (() => {
  'use strict';

  const KEY = 'cp.watch.v2';
  const LEGACY_KEY = 'cp.watch.v1';
  const MAX_DIRS = 10;
  const MAX_ITEMS = 50;

  let db = null;
  const listeners = new Set();

  /* ---------------- 内部工具 ---------------- */

  function uid() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function normBase(b) {
    return String(b || '').trim().toUpperCase();
  }

  function emptyDB() {
    return { version: 2, dirs: [], updatedAt: nowISO() };
  }

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.dirs)) return emptyDB();
    const seenIds = new Set();
    const dirs = [];
    for (const d of raw.dirs) {
      if (dirs.length >= MAX_DIRS) break;
      if (!d || typeof d !== 'object') continue;
      let id = typeof d.id === 'string' && d.id ? d.id : uid();
      while (seenIds.has(id)) id = uid();
      seenIds.add(id);
      const bases = [];
      const seenB = new Set();
      for (const b of Array.isArray(d.bases) ? d.bases : []) {
        const nb = normBase(b);
        if (!nb || seenB.has(nb)) continue;
        if (bases.length >= MAX_ITEMS) break;
        seenB.add(nb);
        bases.push(nb);
      }
      dirs.push({
        id,
        name: String(d.name || '未命名').slice(0, 24),
        bases,
        createdAt: d.createdAt || nowISO(),
        updatedAt: d.updatedAt || nowISO(),
      });
    }
    return { version: 2, dirs, updatedAt: raw.updatedAt || nowISO() };
  }

  function load() {
    if (db) return db;
    let parsed = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }

    if (parsed) {
      db = sanitize(parsed);
    } else {
      // 从旧版迁移
      db = emptyDB();
      try {
        const old = localStorage.getItem(LEGACY_KEY);
        const arr = old ? JSON.parse(old) : null;
        if (Array.isArray(arr) && arr.length) {
          db.dirs.push({
            id: uid(),
            name: '我的自选',
            bases: arr.map(normBase).filter(Boolean).slice(0, MAX_ITEMS),
            createdAt: nowISO(),
            updatedAt: nowISO(),
          });
        }
      } catch (e) { /* 忽略迁移失败 */ }
      persist(false);
    }
    return db;
  }

  function persist(emit = true) {
    db.updatedAt = nowISO();
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      console.warn('[Watch] 保存失败', e);
    }
    if (emit) emitChange();
  }

  function emitChange() {
    for (const fn of listeners) {
      try { fn(db); } catch (e) { console.warn('[Watch] 监听器异常', e); }
    }
  }

  function findDir(id) {
    return load().dirs.find(d => d.id === id) || null;
  }

  /* ---------------- 目录操作 ---------------- */

  function listDirs() {
    return load().dirs.map(d => ({
      id: d.id,
      name: d.name,
      count: d.bases.length,
      capacity: MAX_ITEMS,
      bases: d.bases.slice(),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
  }

  function createDir(name) {
    const d = load();
    if (d.dirs.length >= MAX_DIRS) {
      return { ok: false, reason: 'maxDirs', message: `最多只能建 ${MAX_DIRS} 个自选目录` };
    }
    const clean = String(name || '').trim().slice(0, 24) || `自选 ${d.dirs.length + 1}`;
    const dir = { id: uid(), name: clean, bases: [], createdAt: nowISO(), updatedAt: nowISO() };
    d.dirs.push(dir);
    persist();
    return { ok: true, dir: { ...dir, bases: [] }, message: `已创建「${clean}」` };
  }

  function renameDir(id, name) {
    const dir = findDir(id);
    if (!dir) return { ok: false, reason: 'notFound', message: '目录不存在' };
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) return { ok: false, reason: 'empty', message: '名称不能为空' };
    dir.name = clean;
    dir.updatedAt = nowISO();
    persist();
    return { ok: true, message: `已重命名为「${clean}」` };
  }

  function removeDir(id) {
    const d = load();
    const i = d.dirs.findIndex(x => x.id === id);
    if (i < 0) return { ok: false, reason: 'notFound', message: '目录不存在' };
    const [gone] = d.dirs.splice(i, 1);
    persist();
    return { ok: true, message: `已删除「${gone.name}」` };
  }

  /* ---------------- 币种操作 ---------------- */

  function add(dirId, base) {
    const nb = normBase(base);
    if (!nb) return { ok: false, reason: 'badBase', message: '币种无效' };
    const dir = findDir(dirId);
    if (!dir) return { ok: false, reason: 'notFound', message: '目录不存在' };
    if (dir.bases.includes(nb)) return { ok: false, reason: 'exists', message: `${nb} 已在「${dir.name}」中` };
    if (dir.bases.length >= MAX_ITEMS) {
      return { ok: false, reason: 'maxItems', message: `「${dir.name}」已满 ${MAX_ITEMS} 个，请先移除` };
    }
    dir.bases.push(nb);
    dir.updatedAt = nowISO();
    persist();
    return { ok: true, message: `已加入「${dir.name}」` };
  }

  function remove(dirId, base) {
    const nb = normBase(base);
    const dir = findDir(dirId);
    if (!dir) return { ok: false, reason: 'notFound', message: '目录不存在' };
    const i = dir.bases.indexOf(nb);
    if (i < 0) return { ok: false, reason: 'missing', message: `${nb} 不在该目录中` };
    dir.bases.splice(i, 1);
    dir.updatedAt = nowISO();
    persist();
    return { ok: true, message: `已从「${dir.name}」移除` };
  }

  /** 切换：已在任一目录则移除所有出现处，否则加入指定目录（不指定则用第一个目录，没有则新建） */
  function toggle(dirId, base) {
    const nb = normBase(base);
    const dirs = dirsOf(nb);
    if (dirs.length) {
      for (const d of dirs) remove(d.id, nb);
      return { ok: true, added: false, message: `已移出自选（${dirs.length} 个目录）` };
    }
    let target = dirId ? findDir(dirId) : null;
    if (!target) {
      const d = load();
      if (!d.dirs.length) {
        const r = createDir('我的自选');
        if (!r.ok) return r;
        target = findDir(r.dir.id);
      } else {
        target = d.dirs[0];
      }
    }
    const r = add(target.id, nb);
    return { ...r, added: r.ok };
  }

  function has(base) {
    return dirsOf(base).length > 0;
  }

  function dirsOf(base) {
    const nb = normBase(base);
    return load().dirs.filter(d => d.bases.includes(nb)).map(d => ({ id: d.id, name: d.name }));
  }

  /** 所有目录的去重并集 */
  function allBases() {
    const s = new Set();
    for (const d of load().dirs) for (const b of d.bases) s.add(b);
    return [...s];
  }

  function capacity() {
    const d = load();
    return {
      maxDirs: MAX_DIRS,
      maxItems: MAX_ITEMS,
      usedDirs: d.dirs.length,
      leftDirs: MAX_DIRS - d.dirs.length,
    };
  }

  function exportJSON() {
    return JSON.stringify(load(), null, 2);
  }

  function importJSON(text, mode = 'merge') {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) {
      return { ok: false, reason: 'parse', message: 'JSON 格式错误' };
    }
    const incoming = sanitize(parsed);
    if (!incoming.dirs.length) return { ok: false, reason: 'empty', message: '没有可导入的目录' };
    const d = load();
    if (mode === 'replace') {
      db = incoming;
      persist();
      return { ok: true, message: `已替换为 ${incoming.dirs.length} 个目录` };
    }
    let added = 0;
    for (const src of incoming.dirs) {
      if (d.dirs.length >= MAX_DIRS) break;
      const dir = { id: uid(), name: src.name, bases: src.bases.slice(0, MAX_ITEMS), createdAt: nowISO(), updatedAt: nowISO() };
      d.dirs.push(dir);
      added++;
    }
    persist();
    return { ok: true, message: added ? `已合并 ${added} 个目录` : '目录已达上限，未导入' };
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    MAX_DIRS, MAX_ITEMS,
    listDirs, createDir, renameDir, removeDir,
    add, remove, toggle, has, dirsOf, allBases, capacity,
    exportJSON, importJSON, onChange,
    _reload: () => { db = null; load(); emitChange(); },
  };
})();

if (typeof window !== 'undefined') window.Watch = Watch;

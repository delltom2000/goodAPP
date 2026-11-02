/* ==========================================================================
   PWA — 让页面在安卓上装成独立 App
   1. 注册 Service Worker，使安装提示满足条件
   2. 捕获 beforeinstallprompt，暴露 window.__installPWA() 供页面按钮调用
   ========================================================================== */
(() => {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(reg => {
      window.__swReg = reg;
      // 有更新时静默生效，下次打开就是新版
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            console.info('[PWA] 新版本已就绪，下次打开生效');
          }
        });
      });
    }).catch(err => {
      console.warn('[PWA] Service Worker 注册失败', err);
    });
  });

  let deferred = null;

  window.addEventListener('beforeinstallprompt', ev => {
    ev.preventDefault();
    deferred = ev;
    document.documentElement.dataset.installable = 'true';
    document.querySelectorAll('[data-install]').forEach(b => { b.hidden = false; });
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    document.documentElement.dataset.installable = 'installed';
  });

  /** 供页面按钮调用：返回 'accepted' | 'dismissed' | 'unavailable' */
  window.__installPWA = async () => {
    if (!deferred) return 'unavailable';
    deferred.prompt();
    const choice = await deferred.userChoice;
    deferred = null;
    return choice && choice.outcome ? choice.outcome : 'dismissed';
  };

  /** 是否已经在独立窗口里运行（已安装） */
  window.__isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  /* 断网时给一条明确提示，否则用户会以为行情卡死了 */
  function syncOfflineBar() {
    let bar = document.getElementById('offlineBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'offlineBar';
      document.body.appendChild(bar);
    }
    bar.textContent = '网络不可用 · 当前是缓存界面，行情暂停更新';
    bar.hidden = navigator.onLine;
  }

  window.addEventListener('online', syncOfflineBar);
  window.addEventListener('offline', syncOfflineBar);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncOfflineBar);
  } else {
    syncOfflineBar();
  }
})();

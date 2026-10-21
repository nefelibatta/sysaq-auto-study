import { CONFIG } from './config.js';
import {
  SETTINGS_KEY, loadSettings, saveSettings,
  acquireLease, renewLease, isLeaseOwner, releaseLease,
} from './settings.js';
import { readSnapshot, clickChapter, clickNextPage } from './dom.js';
import { createRunner, PHASE } from './runner.js';
import { createPanel } from './panel.js';
import { createNotifier, createWakeLock, setTitle } from './services.js';

const TITLE_PREFIX = {
  WAIT_PAGE: '等待中',
  RUNNING: '学习中',
  ADVANCING: '学习中',
  PAUSED: '已暂停',
  COMPLETED: '已完成',
  ERROR: '需处理',
};

(function boot() {
  if (document.getElementById('sysaq-auto-study-host')) return;

  const storage = window.localStorage;
  let settings = loadSettings(storage);
  const tabId = (window.crypto && crypto.randomUUID && crypto.randomUUID())
    || String(Math.random()).slice(2);
  const notifier = createNotifier();
  const wakeLock = createWakeLock();
  let pausedByLease = false;
  let lastLeaseRenewAt = 0;
  let lastTitlePrefix = '';

  const panel = createPanel({
    settings,
    callbacks: {
      onToggle() {
        const state = runner.getState();
        if (state.phase === PHASE.COMPLETED) return;
        if (pausedByLease) {
          panel.notify('另一标签页正在自动学习', 'warn');
          return;
        }
        settings = loadSettings(storage);
        if (state.phase === PHASE.ERROR) {
          settings.enabled = true;
          saveSettings(storage, settings);
          runner.resume();
          return;
        }
        settings.enabled = !settings.enabled;
        saveSettings(storage, settings);
        if (settings.enabled) {
          notifier.unlock();
          if (settings.notify) notifier.requestPermission();
          runner.resume();
        } else {
          runner.pause();
        }
      },
      onAdvance() { runner.requestAdvance(); },
      onSetting(key, value) {
        settings = loadSettings(storage);
        settings[key] = value;
        saveSettings(storage, settings);
        if (key === 'keepAwake') {
          if (value) {
            wakeLock.acquire().then((ok) => {
              if (!ok) panel.notify('屏幕常亮不可用或页面不可见', 'warn');
            });
          } else {
            wakeLock.release();
          }
        }
        if (key === 'notify' && value) notifier.requestPermission();
        panel.render(runner.getState());
      },
      onPanelChange(patch) {
        settings = loadSettings(storage);
        settings.panel = { ...settings.panel, ...patch };
        saveSettings(storage, settings);
      },
    },
  });

  const ui = {
    render(state) {
      panel.render(state);
      const prefix = TITLE_PREFIX[state.phase] || '';
      if (prefix !== lastTitlePrefix) {
        setTitle(prefix);
        lastTitlePrefix = prefix;
      }
    },
    warn(msg) { panel.notify(msg, 'warn'); },
    error(msg) { panel.notify(msg, 'error'); },
    logAction(msg) {
      console.log('[sysaq-auto-study]', msg);
      panel.notify(msg, 'info');
    },
    complete() {
      notifier.beep(3);
      if (settings.notify) notifier.notify('自动学习完成', '当前学习任务的所有章节已完成');
      panel.notify('全部章节已完成', 'success');
    },
  };

  const runner = createRunner({
    dom: { readSnapshot, clickChapter, clickNextPage },
    ui,
    getSettings: () => settings,
  });

  function leaseStep(nowMs) {
    if (isLeaseOwner(storage, tabId, nowMs, CONFIG.leaseTtlMs)) {
      if (nowMs - lastLeaseRenewAt >= CONFIG.leaseRenewMs) {
        renewLease(storage, tabId, nowMs, CONFIG.leaseTtlMs);
        lastLeaseRenewAt = nowMs;
      }
      if (runner.getState().phase === PHASE.PAUSED) { pausedByLease = false; runner.resume(); }
      return true;
    }
    if (acquireLease(storage, tabId, nowMs, CONFIG.leaseTtlMs)) {
      lastLeaseRenewAt = nowMs;
      if (runner.getState().phase === PHASE.PAUSED) { pausedByLease = false; runner.resume(); }
      return true;
    }
    if (!pausedByLease) {
      pausedByLease = true;
      runner.pause();
      panel.notify('另一标签页正在自动学习', 'warn');
    }
    return false;
  }

  function loop() {
    const nowMs = Date.now();
    settings = loadSettings(storage);
    if (runner.getState().phase === PHASE.COMPLETED) {
      releaseLease(storage, tabId);
      runner.refresh();
      return;
    }
    if (!settings.enabled) {
      pausedByLease = false;
      if (runner.getState().phase !== PHASE.PAUSED) runner.pause();
      releaseLease(storage, tabId);
      runner.refresh();
      return;
    }
    if (!leaseStep(nowMs)) {
      runner.refresh();
      return;
    }
    runner.tick(nowMs);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      panel.notify('标签页在后台，学习计时可能暂停', 'warn');
      return;
    }
    if (settings.keepAwake) wakeLock.acquire();
  });

  window.addEventListener('pagehide', () => releaseLease(storage, tabId));

  let moTimer = null;
  new MutationObserver(() => {
    if (moTimer) return;
    moTimer = setTimeout(() => { moTimer = null; loop(); }, 1000);
  }).observe(document.body, { childList: true, subtree: true });

  if (settings.keepAwake) wakeLock.acquire();
  document.addEventListener('pointerdown', () => notifier.unlock(), { once: true });

  runner.start();
  loop();
  setInterval(loop, CONFIG.tickMs);
})();

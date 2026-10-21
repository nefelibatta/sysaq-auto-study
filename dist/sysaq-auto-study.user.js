// ==UserScript==
// @name         实验室安全平台自动学习
// @namespace    local.sysaq
// @version      0.1.0
// @description  自动翻页、按学习进度切换下一章节
// @match        https://sysaq.ustc.edu.cn/lab-study-front/examTask/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==
(() => {
  // src/config.js
  var CONFIG = Object.freeze({
    tickMs: 1e3,
    progressEvalMs: 5e3,
    flipIntervalMs: 6e4,
    completeGraceMs: 3e4,
    settleMs: 1e4,
    structureTimeoutMs: 15e3,
    freezeWarnMs: 6e5,
    advanceRetryDelaysMs: [2e3, 5e3, 1e4],
    leaseTtlMs: 15e3,
    leaseRenewMs: 5e3
  });

  // src/settings.js
  var SETTINGS_KEY = "sysaq-auto-study:settings:v1";
  var LEASE_KEY = "sysaq-auto-study:lease:v1";
  var DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    dryRun: false,
    keepAwake: false,
    notify: false,
    panel: Object.freeze({ right: 16, bottom: 16, collapsed: false }),
    version: 1
  });
  function defaults() {
    return { ...DEFAULT_SETTINGS, panel: { ...DEFAULT_SETTINGS.panel } };
  }
  function bool(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }
  function finite(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function loadSettings(storage) {
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      const panel = parsed && typeof parsed.panel === "object" && parsed.panel ? parsed.panel : {};
      return {
        enabled: bool(parsed.enabled, DEFAULT_SETTINGS.enabled),
        dryRun: bool(parsed.dryRun, DEFAULT_SETTINGS.dryRun),
        keepAwake: bool(parsed.keepAwake, DEFAULT_SETTINGS.keepAwake),
        notify: bool(parsed.notify, DEFAULT_SETTINGS.notify),
        panel: {
          right: finite(panel.right, DEFAULT_SETTINGS.panel.right),
          bottom: finite(panel.bottom, DEFAULT_SETTINGS.panel.bottom),
          collapsed: bool(panel.collapsed, DEFAULT_SETTINGS.panel.collapsed)
        },
        version: 1
      };
    } catch {
      try {
        storage.removeItem(SETTINGS_KEY);
      } catch {
      }
      return defaults();
    }
  }
  function saveSettings(storage, settings) {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  function readLease(storage) {
    try {
      const raw = storage.getItem(LEASE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function validLease(lease) {
    return lease && typeof lease.tabId === "string" && Number.isFinite(lease.ts);
  }
  function isLeaseOwner(storage, tabId, nowMs, ttlMs = 15e3) {
    const lease = readLease(storage);
    return Boolean(validLease(lease) && lease.tabId === tabId && nowMs - lease.ts <= ttlMs);
  }
  function acquireLease(storage, tabId, nowMs, ttlMs = 15e3) {
    const lease = readLease(storage);
    const free = !validLease(lease) || lease.tabId === tabId || nowMs - lease.ts > ttlMs;
    if (!free) return false;
    storage.setItem(LEASE_KEY, JSON.stringify({ tabId, ts: nowMs }));
    return true;
  }
  function renewLease(storage, tabId, nowMs, ttlMs = 15e3) {
    if (!isLeaseOwner(storage, tabId, nowMs, ttlMs)) return false;
    storage.setItem(LEASE_KEY, JSON.stringify({ tabId, ts: nowMs }));
    return true;
  }
  function releaseLease(storage, tabId) {
    const lease = readLease(storage);
    if (validLease(lease) && lease.tabId === tabId) {
      try {
        storage.removeItem(LEASE_KEY);
      } catch {
      }
    }
  }

  // src/selectors.js
  var SEL = Object.freeze({
    chapters: ".m-left li.panelItem",
    activeChapter: ".m-left li.panelItem.activeitem",
    chapterTitle: ".itemTitle",
    progress: ".positionRight",
    total: ".m-center .time",
    viewer: ".pptbox",
    canvas: ".vue-pdf-embed__page canvas",
    pageBtn: ".pageBtn",
    nextPage: ".pageBtn span.btn-a"
  });
  var TEXT = Object.freeze({
    nextPage: "\u4E0B\u4E00\u9875"
  });

  // src/core.js
  function parseDuration(text) {
    if (typeof text !== "string") return null;
    const m = text.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const first = Number(m[1]);
    const second = Number(m[2]);
    const third = m[3] === void 0 ? null : Number(m[3]);
    if (second > 59) return null;
    if (third !== null && third > 59) return null;
    return third === null ? first * 60 + second : first * 3600 + second * 60 + third;
  }
  function formatDuration(totalSec) {
    const s = Math.max(0, Math.floor(Number(totalSec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const sec = String(s % 60).padStart(2, "0");
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${sec}`;
    return `${String(m).padStart(2, "0")}:${sec}`;
  }
  function isComplete(learnedSec, requiredSec) {
    return Number.isFinite(requiredSec) && requiredSec > 0 && Number.isFinite(learnedSec) && learnedSec >= requiredSec;
  }
  function progressPercent(learnedSec, requiredSec) {
    if (!Number.isFinite(requiredSec) || requiredSec <= 0) return 0;
    const raw = Math.round(learnedSec / requiredSec * 100);
    return Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
  }
  function parseDocProgress(text) {
    if (typeof text !== "string") return null;
    const m = text.match(/已学习\s*([\d:]+)\s*要求学习\s*([\d:]+)/);
    if (!m) return null;
    const learnedSec = parseDuration(m[1]);
    const requiredSec = parseDuration(m[2]);
    return learnedSec === null || requiredSec === null ? null : { learnedSec, requiredSec };
  }
  function parseTotalProgress(text) {
    if (typeof text !== "string") return null;
    const m = text.match(/([\d:]+)\s*\/\s*([\d:]+)/);
    if (!m) return null;
    const learnedSec = parseDuration(m[1]);
    const requiredSec = parseDuration(m[2]);
    return learnedSec === null || requiredSec === null ? null : { learnedSec, requiredSec };
  }
  function parsePageIndicator(text) {
    if (typeof text !== "string") return null;
    const m = text.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!m) return null;
    const page = Number(m[1]);
    const pageCount = Number(m[2]);
    if (page < 1 || pageCount < 1 || page > pageCount) return null;
    return { page, pageCount };
  }
  function pickNextIndex(length, activeIndex) {
    if (!Number.isInteger(length) || length <= 0) return { kind: "invalid" };
    if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= length) {
      return { kind: "invalid" };
    }
    if (activeIndex === length - 1) return { kind: "end" };
    return { kind: "next", index: activeIndex + 1 };
  }
  function shouldFlip({ page, pageCount, lastFlipAt, now, intervalMs, running }) {
    if (!running) return false;
    if (!Number.isInteger(page) || !Number.isInteger(pageCount)) return false;
    if (page < 1 || page >= pageCount) return false;
    if (!Number.isFinite(lastFlipAt)) return false;
    return now - lastFlipAt >= intervalMs;
  }

  // src/dom.js
  function normalize(el) {
    return (el && el.innerText ? el.innerText : "").replace(/\s+/g, " ").trim();
  }
  function readSnapshot() {
    const chapterEls = [...document.querySelectorAll(SEL.chapters)];
    const chapters = chapterEls.map((el) => normalize(el.querySelector(SEL.chapterTitle) || el));
    const active = document.querySelector(SEL.activeChapter);
    const activeIndex = active ? chapterEls.indexOf(active) : -1;
    const doc = parseDocProgress(normalize(document.querySelector(SEL.progress)));
    const total = parseTotalProgress(normalize(document.querySelector(SEL.total)));
    let viewer = null;
    const viewerEl = document.querySelector(SEL.viewer);
    if (viewerEl) {
      const indicator = [...viewerEl.querySelectorAll(`${SEL.pageBtn} div`)].find((el) => /^\s*\d+\s*\/\s*\d+\s*$/.test(normalize(el)));
      viewer = indicator ? parsePageIndicator(normalize(indicator)) : null;
    }
    const canvasReady = Boolean(viewerEl && viewerEl.querySelector(SEL.canvas));
    return {
      ready: chapterEls.length > 0 && doc !== null && (activeIndex < 0 || viewerEl !== null),
      chapters,
      activeIndex,
      doc,
      total,
      viewer,
      canvasReady
    };
  }
  function clickChapter(index) {
    const els = [...document.querySelectorAll(SEL.chapters)];
    if (!Number.isInteger(index) || index < 0 || index >= els.length) return false;
    els[index].click();
    return true;
  }
  function clickNextPage() {
    const btn = [...document.querySelectorAll(SEL.nextPage)].find((el) => normalize(el) === TEXT.nextPage);
    if (!btn) return false;
    btn.click();
    return true;
  }

  // src/runner.js
  var PHASE = Object.freeze({
    PAUSED: "PAUSED",
    WAIT_PAGE: "WAIT_PAGE",
    RUNNING: "RUNNING",
    ADVANCING: "ADVANCING",
    COMPLETED: "COMPLETED",
    ERROR: "ERROR"
  });
  function createRunner({ dom, ui, config = CONFIG, getSettings, now = () => Date.now() }) {
    let phase = PHASE.PAUSED;
    let message = "";
    let errorCode = null;
    let snapshot = { ready: false, chapters: [], activeIndex: -1, doc: null, total: null, viewer: null, canvasReady: false };
    let page = { current: null, count: null };
    let lastFlipAt = null;
    let completionReachedAt = null;
    let advance = null;
    let dryRunAdvanceLogged = false;
    let lastEvalAt = -Infinity;
    let lastLearnedSec = null;
    let lastProgressChangeAt = null;
    let freezeWarned = false;
    let missingSince = null;
    let completedNotified = false;
    const settings = () => getSettings();
    function setPhase(next, msg = "", code = null) {
      phase = next;
      message = msg;
      errorCode = code;
      if (next === PHASE.RUNNING) missingSince = null;
    }
    function getState() {
      const next = snapshot.chapters.length > 0 ? pickNextIndex(snapshot.chapters.length, snapshot.activeIndex) : { kind: "invalid" };
      return {
        phase,
        message,
        errorCode,
        enabled: Boolean(settings().enabled),
        dryRun: Boolean(settings().dryRun),
        chapters: snapshot.chapters,
        activeIndex: snapshot.activeIndex,
        doc: snapshot.doc,
        total: snapshot.total,
        viewer: page.current === null ? null : { page: page.current, pageCount: page.count },
        nextTitle: next.kind === "next" ? snapshot.chapters[next.index] : null,
        canAdvance: next.kind === "next"
      };
    }
    function render() {
      ui.render(getState());
    }
    function fail(msg, code) {
      setPhase(PHASE.ERROR, msg, code);
      ui.error(msg);
    }
    function read() {
      snapshot = dom.readSnapshot();
      page = snapshot.viewer ? { current: snapshot.viewer.page, count: snapshot.viewer.pageCount } : { current: null, count: null };
    }
    function refresh() {
      read();
      render();
    }
    function start() {
      completedNotified = false;
      setPhase(settings().enabled ? PHASE.WAIT_PAGE : PHASE.PAUSED);
      render();
    }
    function pause() {
      if (phase === PHASE.COMPLETED) return;
      setPhase(PHASE.PAUSED);
      render();
    }
    function resume() {
      if (phase === PHASE.PAUSED || phase === PHASE.ERROR) {
        advance = null;
        lastFlipAt = null;
        completionReachedAt = null;
        lastEvalAt = -Infinity;
        lastLearnedSec = null;
        lastProgressChangeAt = null;
        freezeWarned = false;
        dryRunAdvanceLogged = false;
        missingSince = null;
        setPhase(PHASE.WAIT_PAGE);
        render();
      }
    }
    function finishAdvance() {
      advance = null;
      lastLearnedSec = null;
      lastProgressChangeAt = null;
      completionReachedAt = null;
      lastFlipAt = null;
      freezeWarned = false;
      dryRunAdvanceLogged = false;
      setPhase(PHASE.RUNNING);
    }
    function beginAdvance(nowMs, manual) {
      const next = pickNextIndex(snapshot.chapters.length, snapshot.activeIndex);
      if (next.kind === "invalid") {
        fail("\u627E\u4E0D\u5230\u5F53\u524D\u7AE0\u8282", "no-active");
        return;
      }
      if (next.kind === "end") {
        if (manual) {
          ui.warn("\u5DF2\u7ECF\u662F\u6700\u540E\u4E00\u7AE0");
          return;
        }
        setPhase(PHASE.COMPLETED);
        completionReachedAt = null;
        if (!completedNotified) {
          completedNotified = true;
          ui.complete();
        }
        return;
      }
      const title = snapshot.chapters[next.index];
      if (settings().dryRun) {
        if (!dryRunAdvanceLogged) {
          dryRunAdvanceLogged = true;
          ui.logAction(`\u6F14\u7EC3\uFF1A\u5C06\u5207\u6362\u5230\u4E0B\u4E00\u7AE0 ${title}`);
        }
        return;
      }
      advance = {
        targetIndex: next.index,
        retries: 0,
        retryAt: nowMs + config.advanceRetryDelaysMs[0],
        verifiedAt: null,
        baselineLearned: snapshot.doc ? snapshot.doc.learnedSec : null
      };
      if (!dom.clickChapter(next.index)) {
        advance = null;
        fail("\u70B9\u51FB\u4E0B\u4E00\u7AE0\u5931\u8D25", "advance-failed");
        return;
      }
      ui.logAction(`\u5207\u6362\u5230\u4E0B\u4E00\u7AE0\uFF1A${title}`);
      setPhase(PHASE.ADVANCING, manual ? "\u624B\u52A8\u5207\u6362\u4E2D" : "\u6B63\u5728\u5207\u6362\u4E0B\u4E00\u7AE0");
    }
    function checkAdvance(nowMs) {
      if (!advance) {
        setPhase(PHASE.RUNNING);
        return;
      }
      if (advance.verifiedAt !== null) {
        if (nowMs - advance.verifiedAt >= config.settleMs) {
          const doc = snapshot.doc;
          const notReset = advance.baselineLearned !== null && advance.baselineLearned > 0 && doc && doc.learnedSec >= advance.baselineLearned;
          if (notReset) ui.warn("\u65B0\u7AE0\u8282\u8FDB\u5EA6\u672A\u91CD\u7F6E\uFF0C\u8BF7\u7559\u610F\u5B66\u4E60\u65F6\u957F\u662F\u5426\u6B63\u5E38\u7D2F\u8BA1");
          finishAdvance();
        }
        return;
      }
      if (snapshot.activeIndex === advance.targetIndex && snapshot.canvasReady) {
        advance.verifiedAt = nowMs;
        return;
      }
      if (nowMs < advance.retryAt) return;
      if (advance.retries >= 3) {
        advance = null;
        fail("\u5207\u6362\u4E0B\u4E00\u7AE0\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u9875\u9762", "advance-failed");
        return;
      }
      advance.retries += 1;
      if (settings().dryRun) {
        ui.logAction(`\u6F14\u7EC3\uFF1A\u5C06\u91CD\u8BD5\u5207\u6362\u5230\u4E0B\u4E00\u7AE0\uFF08\u7B2C ${advance.retries} \u6B21\uFF09`);
      } else {
        dom.clickChapter(advance.targetIndex);
        ui.logAction(`\u91CD\u8BD5\u5207\u6362\u4E0B\u4E00\u7AE0\uFF08\u7B2C ${advance.retries} \u6B21\uFF09`);
      }
      advance.retryAt = nowMs + (config.advanceRetryDelaysMs[advance.retries] ?? 1e4);
    }
    function evaluate(nowMs) {
      lastEvalAt = nowMs;
      const doc = snapshot.doc;
      if (!doc) {
        fail("\u672A\u627E\u5230\u5B66\u4E60\u8FDB\u5EA6", "no-progress");
        return;
      }
      if (!Number.isFinite(doc.requiredSec) || doc.requiredSec <= 0) {
        fail("\u8981\u6C42\u5B66\u4E60\u65F6\u957F\u65E0\u6548\uFF0C\u65E0\u6CD5\u5224\u65AD\u5B8C\u6210", "invalid-required");
        return;
      }
      if (doc.learnedSec !== lastLearnedSec) {
        lastLearnedSec = doc.learnedSec;
        lastProgressChangeAt = nowMs;
        freezeWarned = false;
      }
      if (!isComplete(doc.learnedSec, doc.requiredSec)) {
        completionReachedAt = null;
        dryRunAdvanceLogged = false;
        if (!freezeWarned && lastProgressChangeAt !== null && nowMs - lastProgressChangeAt >= config.freezeWarnMs) {
          freezeWarned = true;
          ui.warn("\u5B66\u4E60\u8FDB\u5EA6 10 \u5206\u949F\u672A\u589E\u957F\uFF0C\u8BF7\u4FDD\u6301\u6807\u7B7E\u9875\u53EF\u89C1\u5E76\u68C0\u67E5\u7F51\u7EDC");
        }
        return;
      }
      if (completionReachedAt === null) completionReachedAt = nowMs;
    }
    function recoverIfHealthy() {
      if (phase !== PHASE.ERROR || errorCode === "advance-failed") return;
      const doc = snapshot.doc;
      const healthy = snapshot.ready && (errorCode !== "no-active" || snapshot.activeIndex >= 0) && (errorCode !== "invalid-required" || doc !== null && doc.requiredSec > 0);
      if (healthy) setPhase(PHASE.WAIT_PAGE);
    }
    function ensureStructure(nowMs) {
      if (snapshot.ready) {
        missingSince = null;
        if (phase === PHASE.WAIT_PAGE) setPhase(PHASE.RUNNING);
        return true;
      }
      if (missingSince === null) missingSince = nowMs;
      if ((phase === PHASE.WAIT_PAGE || phase === PHASE.RUNNING) && nowMs - missingSince >= config.structureTimeoutMs) {
        fail("\u9875\u9762\u7ED3\u6784\u672A\u8BC6\u522B\uFF0C\u5E73\u53F0\u53EF\u80FD\u6539\u7248", "structure");
      }
      return false;
    }
    function tick(nowMs = now()) {
      read();
      if (phase === PHASE.PAUSED || phase === PHASE.COMPLETED) {
        render();
        return;
      }
      if (phase === PHASE.ERROR) recoverIfHealthy();
      if (phase === PHASE.ADVANCING) {
        checkAdvance(nowMs);
        render();
        return;
      }
      if (!ensureStructure(nowMs)) {
        render();
        return;
      }
      if (phase !== PHASE.RUNNING) {
        render();
        return;
      }
      if (snapshot.activeIndex < 0) {
        fail("\u627E\u4E0D\u5230\u5F53\u524D\u7AE0\u8282", "no-active");
        render();
        return;
      }
      if (nowMs - lastEvalAt >= config.progressEvalMs) evaluate(nowMs);
      if (phase !== PHASE.RUNNING) {
        render();
        return;
      }
      if (completionReachedAt !== null) {
        const doc = snapshot.doc;
        if (!doc || !isComplete(doc.learnedSec, doc.requiredSec)) {
          completionReachedAt = null;
          dryRunAdvanceLogged = false;
        } else if (nowMs - completionReachedAt >= config.completeGraceMs) {
          beginAdvance(nowMs, false);
          if (phase !== PHASE.RUNNING) {
            render();
            return;
          }
        }
      }
      if (page.current !== null && lastFlipAt === null) lastFlipAt = nowMs;
      if (shouldFlip({
        page: page.current,
        pageCount: page.count,
        lastFlipAt,
        now: nowMs,
        intervalMs: config.flipIntervalMs,
        running: phase === PHASE.RUNNING
      })) {
        lastFlipAt = nowMs;
        const ok = settings().dryRun ? true : dom.clickNextPage();
        if (ok) {
          ui.logAction(`\u7FFB\u5230\u7B2C ${Math.min(page.current + 1, page.count)} \u9875`);
          page.current = Math.min(page.current + 1, page.count);
        }
      }
      render();
    }
    function requestAdvance(nowMs = now()) {
      if (phase !== PHASE.RUNNING) {
        ui.warn("\u5F53\u524D\u4E0D\u5728\u8FD0\u884C\u72B6\u6001");
        return;
      }
      read();
      if (!snapshot.ready) {
        ui.warn("\u9875\u9762\u5C1A\u672A\u5C31\u7EEA");
        return;
      }
      beginAdvance(nowMs, true);
      render();
    }
    return { start, tick, refresh, pause, resume, requestAdvance, getState };
  }

  // src/panel.css
  var panel_default = ':host { all: initial; }\n* { box-sizing: border-box; }\n.panel {\n  position: fixed;\n  z-index: 2147483647;\n  width: 300px;\n  background: #fff;\n  color: #1f2329;\n  border: 1px solid #d9dde3;\n  border-radius: 10px;\n  box-shadow: 0 8px 28px rgba(0, 0, 0, .18);\n  font: 12px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;\n  overflow: hidden;\n  user-select: none;\n}\n.hd {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 10px;\n  background: #f5f7fa;\n  border-bottom: 1px solid #e5e8ec;\n  cursor: move;\n}\n.hd .title { font-weight: 600; }\n.hd .phase { margin-left: auto; color: #646a73; }\n.hd button {\n  border: 0; background: transparent; cursor: pointer;\n  font-size: 14px; line-height: 1; color: #646a73; padding: 2px 4px;\n}\n.dot { width: 8px; height: 8px; border-radius: 50%; background: #8f959e; }\n.dot[data-phase="RUNNING"] { background: #34a853; }\n.dot[data-phase="ADVANCING"] { background: #fbbc04; }\n.dot[data-phase="COMPLETED"] { background: #1a73e8; }\n.dot[data-phase="ERROR"] { background: #ea4335; }\n.bd { padding: 10px 12px 12px; }\n.row { display: flex; gap: 8px; margin: 4px 0; }\n.row .k { flex: 0 0 58px; color: #8f959e; }\n.row .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.bar { height: 6px; background: #eef0f3; border-radius: 3px; overflow: hidden; margin: 6px 0 8px; }\n.bar .fill { height: 100%; width: 0; background: #1a73e8; transition: width .3s; }\n.msg { min-height: 18px; margin: 4px 0; color: #646a73; word-break: break-all; }\n.msg.warn { color: #b06000; }\n.msg.error { color: #c5221f; }\n.msg.success { color: #137333; }\n.actions { display: flex; gap: 8px; margin-top: 8px; }\n.actions button {\n  flex: 1; padding: 6px 8px; border-radius: 6px; cursor: pointer;\n  border: 1px solid #d9dde3; background: #fff; color: #1f2329;\n}\n.actions button:hover { background: #f5f7fa; }\n.actions button:disabled { opacity: .5; cursor: default; }\n.options { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; color: #646a73; }\n.options label { display: flex; align-items: center; gap: 4px; cursor: pointer; }\n.panel.collapsed { width: auto; }\n.panel.collapsed .bd { display: none; }\n.panel.collapsed .hd { border-bottom: 0; }\n';

  // src/panel.js
  var PHASE_LABEL = {
    PAUSED: "\u5DF2\u6682\u505C",
    WAIT_PAGE: "\u7B49\u5F85\u9875\u9762",
    RUNNING: "\u8FD0\u884C\u4E2D",
    ADVANCING: "\u5207\u6362\u7AE0\u8282\u4E2D",
    COMPLETED: "\u5168\u90E8\u5B8C\u6210",
    ERROR: "\u9700\u5904\u7406"
  };
  function fmt(sec) {
    return sec === null || sec === void 0 ? "--:--" : formatDuration(sec);
  }
  function createPanel({ settings, callbacks }) {
    const host = document.createElement("div");
    host.id = "sysaq-auto-study-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = panel_default;
    shadow.appendChild(style);
    const root = document.createElement("div");
    root.className = "panel" + (settings.panel.collapsed ? " collapsed" : "");
    root.style.right = settings.panel.right + "px";
    root.style.bottom = settings.panel.bottom + "px";
    root.innerHTML = `
    <div class="hd">
      <span class="dot"></span>
      <span class="title">\u81EA\u52A8\u5B66\u4E60</span>
      <span class="phase">\u5DF2\u6682\u505C</span>
      <button class="collapse" title="\u6536\u8D77">\uFF0D</button>
    </div>
    <div class="bd">
      <div class="row"><span class="k">\u5F53\u524D\u7AE0\u8282</span><span class="v chapter">--</span></div>
      <div class="row"><span class="k">\u672C\u6587\u6863</span><span class="v doc">--:-- / --:--</span></div>
      <div class="bar"><div class="fill"></div></div>
      <div class="row"><span class="k">\u603B\u65F6\u957F</span><span class="v total">--:-- / --:--</span></div>
      <div class="row"><span class="k">\u7FFB\u9875</span><span class="v page">--</span></div>
      <div class="row"><span class="k">\u4E0B\u4E00\u6B65</span><span class="v next">--</span></div>
      <div class="msg"></div>
      <div class="actions">
        <button class="toggle">\u542F\u7528</button>
        <button class="advance">\u7ACB\u5373\u8DF3\u4E0B\u4E00\u7AE0</button>
      </div>
      <div class="options">
        <label><input type="checkbox" class="dry"> \u6F14\u7EC3\u6A21\u5F0F</label>
        <label><input type="checkbox" class="awake"> \u5C4F\u5E55\u5E38\u4EAE</label>
        <label><input type="checkbox" class="notify"> \u901A\u77E5</label>
      </div>
    </div>`;
    shadow.appendChild(root);
    document.documentElement.appendChild(host);
    const q = (sel) => root.querySelector(sel);
    const els = {
      dot: q(".dot"),
      phase: q(".phase"),
      chapter: q(".chapter"),
      doc: q(".doc"),
      fill: q(".fill"),
      total: q(".total"),
      page: q(".page"),
      next: q(".next"),
      msg: q(".msg"),
      toggle: q(".toggle")
    };
    const dry = q(".dry");
    const awake = q(".awake");
    const notifyBox = q(".notify");
    const collapseBtn = q(".collapse");
    dry.checked = settings.dryRun;
    awake.checked = settings.keepAwake;
    notifyBox.checked = settings.notify;
    collapseBtn.textContent = root.classList.contains("collapsed") ? "\uFF0B" : "\uFF0D";
    let msgTimer = null;
    let hasRun = false;
    function notify(text, level = "info") {
      els.msg.textContent = text || "";
      els.msg.className = "msg " + level;
      if (msgTimer) clearTimeout(msgTimer);
      if (text) msgTimer = setTimeout(() => {
        els.msg.textContent = "";
        els.msg.className = "msg";
      }, 8e3);
    }
    function render(state) {
      if (state.phase !== "PAUSED") hasRun = true;
      els.phase.textContent = PHASE_LABEL[state.phase] || state.phase;
      els.dot.dataset.phase = state.phase;
      els.chapter.textContent = state.chapters[state.activeIndex] || "--";
      if (state.doc) {
        els.doc.textContent = `${fmt(state.doc.learnedSec)} / ${fmt(state.doc.requiredSec)}`;
        els.fill.style.width = progressPercent(state.doc.learnedSec, state.doc.requiredSec) + "%";
      } else {
        els.doc.textContent = "--:-- / --:--";
        els.fill.style.width = "0%";
      }
      els.total.textContent = state.total ? `${fmt(state.total.learnedSec)} / ${fmt(state.total.requiredSec)}` : "--:-- / --:--";
      els.page.textContent = state.viewer ? `${state.viewer.page} / ${state.viewer.pageCount}` : "--";
      if (state.phase === "RUNNING" && state.doc) {
        const remain = Math.max(0, state.doc.requiredSec - state.doc.learnedSec);
        els.next.textContent = remain > 0 ? `\u8FD8\u9700 ${fmt(remain)}\uFF0C\u8FBE\u6807\u540E\u8DF3\u7AE0` : "\u7B49\u5F85\u786E\u8BA4\u540E\u8DF3\u7AE0";
      } else if (state.nextTitle) {
        els.next.textContent = `\u4E0B\u4E00\u7AE0\uFF1A${state.nextTitle}`;
      } else {
        els.next.textContent = state.phase === "COMPLETED" ? "\u6CA1\u6709\u4E0B\u4E00\u7AE0\u8282" : "--";
      }
      const label = state.phase === "COMPLETED" ? "\u5DF2\u5B8C\u6210" : state.phase === "ERROR" ? "\u91CD\u8BD5" : state.phase === "PAUSED" ? hasRun ? "\u7EE7\u7EED" : "\u542F\u7528" : "\u6682\u505C";
      els.toggle.textContent = label;
      els.toggle.disabled = state.phase === "COMPLETED";
      dry.checked = Boolean(state.dryRun);
    }
    els.toggle.addEventListener("click", () => callbacks.onToggle());
    q(".advance").addEventListener("click", () => callbacks.onAdvance());
    dry.addEventListener("change", () => callbacks.onSetting("dryRun", dry.checked));
    awake.addEventListener("change", () => callbacks.onSetting("keepAwake", awake.checked));
    notifyBox.addEventListener("change", () => callbacks.onSetting("notify", notifyBox.checked));
    collapseBtn.addEventListener("click", () => {
      root.classList.toggle("collapsed");
      collapseBtn.textContent = root.classList.contains("collapsed") ? "\uFF0B" : "\uFF0D";
      callbacks.onPanelChange({ collapsed: root.classList.contains("collapsed") });
    });
    const hd = q(".hd");
    let drag = null;
    hd.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const rect = root.getBoundingClientRect();
      drag = {
        x: e.clientX,
        y: e.clientY,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom
      };
      hd.setPointerCapture(e.pointerId);
    });
    hd.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const right = Math.max(8, Math.min(window.innerWidth - 80, drag.right - (e.clientX - drag.x)));
      const bottom = Math.max(8, Math.min(window.innerHeight - 60, drag.bottom - (e.clientY - drag.y)));
      root.style.right = right + "px";
      root.style.bottom = bottom + "px";
    });
    hd.addEventListener("pointerup", (e) => {
      if (!drag) return;
      drag = null;
      hd.releasePointerCapture(e.pointerId);
      callbacks.onPanelChange({
        right: parseInt(root.style.right, 10) || 16,
        bottom: parseInt(root.style.bottom, 10) || 16
      });
    });
    return {
      render,
      notify,
      destroy() {
        if (msgTimer) clearTimeout(msgTimer);
        host.remove();
      }
    };
  }

  // src/services.js
  var audioCtx = null;
  function createNotifier() {
    function unlock() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === "suspended") audioCtx.resume();
      } catch {
      }
    }
    function beep(times = 3) {
      if (!audioCtx) return;
      try {
        let t = audioCtx.currentTime;
        for (let i = 0; i < times; i += 1) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(1e-4, t);
          gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(1e-4, t + 0.3);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(t);
          osc.stop(t + 0.32);
          t += 0.45;
        }
      } catch {
      }
    }
    async function requestPermission() {
      if (!("Notification" in window)) return false;
      if (Notification.permission === "granted") return true;
      if (Notification.permission === "denied") return false;
      try {
        return await Notification.requestPermission() === "granted";
      } catch {
        return false;
      }
    }
    function notify(title, body) {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      try {
        new Notification(title, { body });
      } catch {
      }
    }
    return { unlock, beep, requestPermission, notify };
  }
  function createWakeLock() {
    let sentinel = null;
    async function acquire() {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return false;
      try {
        sentinel = await navigator.wakeLock.request("screen");
        return true;
      } catch {
        return false;
      }
    }
    async function release() {
      try {
        await sentinel?.release();
      } catch {
      }
      sentinel = null;
    }
    return { acquire, release };
  }
  function setTitle(prefix) {
    const base = document.title.replace(/^\[[^\]]+\]\s*/, "");
    document.title = prefix ? `[${prefix}] ${base}` : base;
  }

  // src/main.js
  var TITLE_PREFIX = {
    WAIT_PAGE: "\u7B49\u5F85\u4E2D",
    RUNNING: "\u5B66\u4E60\u4E2D",
    ADVANCING: "\u5B66\u4E60\u4E2D",
    PAUSED: "\u5DF2\u6682\u505C",
    COMPLETED: "\u5DF2\u5B8C\u6210",
    ERROR: "\u9700\u5904\u7406"
  };
  (function boot() {
    if (document.getElementById("sysaq-auto-study-host")) return;
    const storage = window.localStorage;
    let settings = loadSettings(storage);
    const tabId = window.crypto && crypto.randomUUID && crypto.randomUUID() || String(Math.random()).slice(2);
    const notifier = createNotifier();
    const wakeLock = createWakeLock();
    let pausedByLease = false;
    let lastLeaseRenewAt = 0;
    let lastTitlePrefix = "";
    const panel = createPanel({
      settings,
      callbacks: {
        onToggle() {
          const state = runner.getState();
          if (state.phase === PHASE.COMPLETED) return;
          if (pausedByLease) {
            panel.notify("\u53E6\u4E00\u6807\u7B7E\u9875\u6B63\u5728\u81EA\u52A8\u5B66\u4E60", "warn");
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
        onAdvance() {
          runner.requestAdvance();
        },
        onSetting(key, value) {
          settings = loadSettings(storage);
          settings[key] = value;
          saveSettings(storage, settings);
          if (key === "keepAwake") {
            if (value) {
              wakeLock.acquire().then((ok) => {
                if (!ok) panel.notify("\u5C4F\u5E55\u5E38\u4EAE\u4E0D\u53EF\u7528\u6216\u9875\u9762\u4E0D\u53EF\u89C1", "warn");
              });
            } else {
              wakeLock.release();
            }
          }
          if (key === "notify" && value) notifier.requestPermission();
          panel.render(runner.getState());
        },
        onPanelChange(patch) {
          settings = loadSettings(storage);
          settings.panel = { ...settings.panel, ...patch };
          saveSettings(storage, settings);
        }
      }
    });
    const ui = {
      render(state) {
        panel.render(state);
        const prefix = TITLE_PREFIX[state.phase] || "";
        if (prefix !== lastTitlePrefix) {
          setTitle(prefix);
          lastTitlePrefix = prefix;
        }
      },
      warn(msg) {
        panel.notify(msg, "warn");
      },
      error(msg) {
        panel.notify(msg, "error");
      },
      logAction(msg) {
        console.log("[sysaq-auto-study]", msg);
        panel.notify(msg, "info");
      },
      complete() {
        notifier.beep(3);
        if (settings.notify) notifier.notify("\u81EA\u52A8\u5B66\u4E60\u5B8C\u6210", "\u5F53\u524D\u5B66\u4E60\u4EFB\u52A1\u7684\u6240\u6709\u7AE0\u8282\u5DF2\u5B8C\u6210");
        panel.notify("\u5168\u90E8\u7AE0\u8282\u5DF2\u5B8C\u6210", "success");
      }
    };
    const runner = createRunner({
      dom: { readSnapshot, clickChapter, clickNextPage },
      ui,
      getSettings: () => settings
    });
    function leaseStep(nowMs) {
      if (isLeaseOwner(storage, tabId, nowMs, CONFIG.leaseTtlMs)) {
        if (nowMs - lastLeaseRenewAt >= CONFIG.leaseRenewMs) {
          renewLease(storage, tabId, nowMs, CONFIG.leaseTtlMs);
          lastLeaseRenewAt = nowMs;
        }
        if (runner.getState().phase === PHASE.PAUSED) {
          pausedByLease = false;
          runner.resume();
        }
        return true;
      }
      if (acquireLease(storage, tabId, nowMs, CONFIG.leaseTtlMs)) {
        lastLeaseRenewAt = nowMs;
        if (runner.getState().phase === PHASE.PAUSED) {
          pausedByLease = false;
          runner.resume();
        }
        return true;
      }
      if (!pausedByLease) {
        pausedByLease = true;
        runner.pause();
        panel.notify("\u53E6\u4E00\u6807\u7B7E\u9875\u6B63\u5728\u81EA\u52A8\u5B66\u4E60", "warn");
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
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        panel.notify("\u6807\u7B7E\u9875\u5728\u540E\u53F0\uFF0C\u5B66\u4E60\u8BA1\u65F6\u53EF\u80FD\u6682\u505C", "warn");
        return;
      }
      if (settings.keepAwake) wakeLock.acquire();
    });
    window.addEventListener("pagehide", () => releaseLease(storage, tabId));
    let moTimer = null;
    new MutationObserver(() => {
      if (moTimer) return;
      moTimer = setTimeout(() => {
        moTimer = null;
        loop();
      }, 1e3);
    }).observe(document.body, { childList: true, subtree: true });
    if (settings.keepAwake) wakeLock.acquire();
    document.addEventListener("pointerdown", () => notifier.unlock(), { once: true });
    runner.start();
    loop();
    setInterval(loop, CONFIG.tickMs);
  })();
})();

import { CONFIG } from './config.js';
import { isComplete, pickNextIndex, shouldFlip } from './core.js';

export const PHASE = Object.freeze({
  PAUSED: 'PAUSED',
  WAIT_PAGE: 'WAIT_PAGE',
  RUNNING: 'RUNNING',
  ADVANCING: 'ADVANCING',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
});

export function createRunner({ dom, ui, config = CONFIG, getSettings, now = () => Date.now() }) {
  let phase = PHASE.PAUSED;
  let message = '';
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

  function setPhase(next, msg = '', code = null) {
    phase = next;
    message = msg;
    errorCode = code;
    if (next === PHASE.RUNNING) missingSince = null;
  }

  function getState() {
    const next = snapshot.chapters.length > 0
      ? pickNextIndex(snapshot.chapters.length, snapshot.activeIndex)
      : { kind: 'invalid' };
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
      nextTitle: next.kind === 'next' ? snapshot.chapters[next.index] : null,
      canAdvance: next.kind === 'next',
    };
  }

  function render() { ui.render(getState()); }
  function fail(msg, code) { setPhase(PHASE.ERROR, msg, code); ui.error(msg); }

  function read() {
    snapshot = dom.readSnapshot();
    page = snapshot.viewer
      ? { current: snapshot.viewer.page, count: snapshot.viewer.pageCount }
      : { current: null, count: null };
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
    if (next.kind === 'invalid') { fail('找不到当前章节', 'no-active'); return; }
    if (next.kind === 'end') {
      if (manual) { ui.warn('已经是最后一章'); return; }
      setPhase(PHASE.COMPLETED);
      completionReachedAt = null;
      if (!completedNotified) { completedNotified = true; ui.complete(); }
      return;
    }
    const title = snapshot.chapters[next.index];
    if (settings().dryRun) {
      if (!dryRunAdvanceLogged) {
        dryRunAdvanceLogged = true;
        ui.logAction(`演练：将切换到下一章 ${title}`);
      }
      return;
    }
    advance = {
      targetIndex: next.index,
      retries: 0,
      retryAt: nowMs + config.advanceRetryDelaysMs[0],
      verifiedAt: null,
      baselineLearned: snapshot.doc ? snapshot.doc.learnedSec : null,
    };
    if (!dom.clickChapter(next.index)) {
      advance = null;
      fail('点击下一章失败', 'advance-failed');
      return;
    }
    ui.logAction(`切换到下一章：${title}`);
    setPhase(PHASE.ADVANCING, manual ? '手动切换中' : '正在切换下一章');
  }

  function checkAdvance(nowMs) {
    if (!advance) { setPhase(PHASE.RUNNING); return; }
    if (advance.verifiedAt !== null) {
      if (nowMs - advance.verifiedAt >= config.settleMs) {
        const doc = snapshot.doc;
        const notReset = advance.baselineLearned !== null && advance.baselineLearned > 0
          && doc && doc.learnedSec >= advance.baselineLearned;
        if (notReset) ui.warn('新章节进度未重置，请留意学习时长是否正常累计');
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
      fail('切换下一章失败，请检查页面', 'advance-failed');
      return;
    }
    advance.retries += 1;
    if (settings().dryRun) {
      ui.logAction(`演练：将重试切换到下一章（第 ${advance.retries} 次）`);
    } else {
      dom.clickChapter(advance.targetIndex);
      ui.logAction(`重试切换下一章（第 ${advance.retries} 次）`);
    }
    advance.retryAt = nowMs + (config.advanceRetryDelaysMs[advance.retries] ?? 10000);
  }

  function evaluate(nowMs) {
    lastEvalAt = nowMs;
    const doc = snapshot.doc;
    if (!doc) { fail('未找到学习进度', 'no-progress'); return; }
    if (!Number.isFinite(doc.requiredSec) || doc.requiredSec <= 0) {
      fail('要求学习时长无效，无法判断完成', 'invalid-required');
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
      if (!freezeWarned && lastProgressChangeAt !== null
          && nowMs - lastProgressChangeAt >= config.freezeWarnMs) {
        freezeWarned = true;
        ui.warn('学习进度 10 分钟未增长，请保持标签页可见并检查网络');
      }
      return;
    }
    if (completionReachedAt === null) completionReachedAt = nowMs;
  }

  function recoverIfHealthy() {
    if (phase !== PHASE.ERROR || errorCode === 'advance-failed') return;
    const doc = snapshot.doc;
    const healthy = snapshot.ready
      && (errorCode !== 'no-active' || snapshot.activeIndex >= 0)
      && (errorCode !== 'invalid-required' || (doc !== null && doc.requiredSec > 0));
    if (healthy) setPhase(PHASE.WAIT_PAGE);
  }

  function ensureStructure(nowMs) {
    if (snapshot.ready) {
      missingSince = null;
      if (phase === PHASE.WAIT_PAGE) setPhase(PHASE.RUNNING);
      return true;
    }
    if (missingSince === null) missingSince = nowMs;
    if ((phase === PHASE.WAIT_PAGE || phase === PHASE.RUNNING)
        && nowMs - missingSince >= config.structureTimeoutMs) {
      fail('页面结构未识别，平台可能改版', 'structure');
    }
    return false;
  }

  function tick(nowMs = now()) {
    read();
    if (phase === PHASE.PAUSED || phase === PHASE.COMPLETED) { render(); return; }
    if (phase === PHASE.ERROR) recoverIfHealthy();
    if (phase === PHASE.ADVANCING) { checkAdvance(nowMs); render(); return; }
    if (!ensureStructure(nowMs)) { render(); return; }
    if (phase !== PHASE.RUNNING) { render(); return; }
    if (snapshot.activeIndex < 0) { fail('找不到当前章节', 'no-active'); render(); return; }

    if (nowMs - lastEvalAt >= config.progressEvalMs) evaluate(nowMs);
    if (phase !== PHASE.RUNNING) { render(); return; }

    if (completionReachedAt !== null) {
      const doc = snapshot.doc;
      if (!doc || !isComplete(doc.learnedSec, doc.requiredSec)) {
        completionReachedAt = null;
        dryRunAdvanceLogged = false;
      } else if (nowMs - completionReachedAt >= config.completeGraceMs) {
        beginAdvance(nowMs, false);
        if (phase !== PHASE.RUNNING) { render(); return; }
      }
    }

    if (page.current !== null && lastFlipAt === null) lastFlipAt = nowMs;
    if (shouldFlip({
      page: page.current,
      pageCount: page.count,
      lastFlipAt,
      now: nowMs,
      intervalMs: config.flipIntervalMs,
      running: phase === PHASE.RUNNING,
    })) {
      lastFlipAt = nowMs;
      const ok = settings().dryRun ? true : dom.clickNextPage();
      if (ok) {
        ui.logAction(`翻到第 ${Math.min(page.current + 1, page.count)} 页`);
        page.current = Math.min(page.current + 1, page.count);
      }
    }
    render();
  }

  function requestAdvance(nowMs = now()) {
    if (phase !== PHASE.RUNNING) { ui.warn('当前不在运行状态'); return; }
    read();
    if (!snapshot.ready) { ui.warn('页面尚未就绪'); return; }
    beginAdvance(nowMs, true);
    render();
  }

  return { start, tick, refresh, pause, resume, requestAdvance, getState };
}

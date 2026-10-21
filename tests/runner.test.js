import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunner, PHASE } from '../src/runner.js';

function makeEnv(overrides = {}) {
  const snap = {
    ready: true,
    chapters: ['A', 'B', 'C'],
    activeIndex: 0,
    doc: { learnedSec: 0, requiredSec: 1800 },
    total: { learnedSec: 0, requiredSec: 10800 },
    viewer: { page: 1, pageCount: 22 },
    canvasReady: true,
    ...overrides,
  };
  const calls = { chapter: [], nextPage: 0, renders: [], warns: [], errors: [], logs: [], completes: 0 };
  const settings = { enabled: true, dryRun: false };
  let switchOnClick = true;

  const dom = {
    readSnapshot: () => ({
      ...snap,
      chapters: [...snap.chapters],
      doc: snap.doc ? { ...snap.doc } : null,
      total: snap.total ? { ...snap.total } : null,
      viewer: snap.viewer ? { ...snap.viewer } : null,
    }),
    clickChapter(index) {
      calls.chapter.push(index);
      if (switchOnClick) {
        snap.activeIndex = index;
        snap.doc = { learnedSec: 0, requiredSec: 1800 };
        snap.viewer = { page: 1, pageCount: 22 };
      }
      return true;
    },
    clickNextPage() {
      calls.nextPage += 1;
      if (snap.viewer) snap.viewer = { ...snap.viewer, page: Math.min(snap.viewer.page + 1, snap.viewer.pageCount) };
      return true;
    },
  };
  const ui = {
    render: (s) => calls.renders.push(s.phase),
    warn: (m) => calls.warns.push(m),
    error: (m) => calls.errors.push(m),
    logAction: (m) => calls.logs.push(m),
    complete: () => { calls.completes += 1; },
  };
  const runner = createRunner({ dom, ui, getSettings: () => settings });
  return {
    snap, calls, settings, runner,
    setSwitchOnClick: (v) => { switchOnClick = v; },
  };
}

test('启动后等待页面，就绪进入 RUNNING', () => {
  const env = makeEnv();
  env.runner.start();
  assert.equal(env.runner.getState().phase, PHASE.WAIT_PAGE);
  env.runner.tick(0);
  assert.equal(env.runner.getState().phase, PHASE.RUNNING);
});

test('每 60 秒翻一页，最后一页停止，暂停时不翻页', () => {
  const env = makeEnv();
  env.runner.start();
  env.runner.tick(0);
  env.runner.tick(59999);
  assert.equal(env.calls.nextPage, 0);
  env.runner.tick(60000);
  assert.equal(env.calls.nextPage, 1);
  env.runner.pause();
  env.runner.tick(180000);
  assert.equal(env.calls.nextPage, 1);
  env.runner.resume();
  env.snap.viewer.page = 22;
  env.runner.tick(181000);
  env.runner.tick(300000);
  assert.equal(env.calls.nextPage, 1);
});

test('学习达标后经过 30 秒确认期切换到下一章，并在 10 秒稳定期后恢复', () => {
  const env = makeEnv({ doc: { learnedSec: 1799, requiredSec: 1800 } });
  env.runner.start();
  env.runner.tick(0);
  env.snap.doc.learnedSec = 1800;
  env.runner.tick(5000);
  env.runner.tick(34000);
  assert.equal(env.runner.getState().phase, PHASE.RUNNING);
  env.runner.tick(35000);
  assert.equal(env.runner.getState().phase, PHASE.ADVANCING);
  assert.deepEqual(env.calls.chapter, [1]);
  env.runner.tick(36000);
  assert.equal(env.runner.getState().phase, PHASE.ADVANCING);
  env.runner.tick(46000);
  assert.equal(env.runner.getState().phase, PHASE.RUNNING);
});

test('最后一章达标后进入 COMPLETED 且通知只发一次', () => {
  const env = makeEnv({ activeIndex: 2, doc: { learnedSec: 1800, requiredSec: 1800 } });
  env.runner.start();
  env.runner.tick(0);
  env.runner.tick(30000);
  assert.equal(env.runner.getState().phase, PHASE.COMPLETED);
  assert.equal(env.calls.completes, 1);
  env.runner.tick(60000);
  assert.equal(env.calls.completes, 1);
  assert.equal(env.calls.chapter.length, 0);
});

test('切换失败重试 3 次后进入 ERROR', () => {
  const env = makeEnv({ doc: { learnedSec: 1800, requiredSec: 1800 } });
  env.setSwitchOnClick(false);
  env.runner.start();
  env.runner.tick(0);
  env.runner.tick(30000);
  assert.equal(env.runner.getState().phase, PHASE.ADVANCING);
  env.runner.tick(32000);
  env.runner.tick(37000);
  env.runner.tick(47000);
  assert.equal(env.calls.chapter.length, 4);
  env.runner.tick(57000);
  assert.equal(env.runner.getState().phase, PHASE.ERROR);
  assert.equal(env.calls.errors.length, 1);
});

test('结构缺失 15 秒后报错，恢复后可继续', () => {
  const env = makeEnv({ ready: false });
  env.runner.start();
  env.runner.tick(0);
  env.runner.tick(16000);
  assert.equal(env.runner.getState().phase, PHASE.ERROR);
  env.snap.ready = true;
  env.runner.tick(17000);
  assert.equal(env.runner.getState().phase, PHASE.RUNNING);
});

test('演练模式不点击，但记录动作', () => {
  const env = makeEnv({ doc: { learnedSec: 1800, requiredSec: 1800 } });
  env.settings.dryRun = true;
  env.runner.start();
  env.runner.tick(0);
  env.runner.tick(30000);
  assert.equal(env.calls.chapter.length, 0);
  assert.equal(env.runner.getState().phase, PHASE.RUNNING);
  assert.ok(env.calls.logs.some((m) => m.includes('演练')));
});

test('手动跳章不要求达标', () => {
  const env = makeEnv();
  env.runner.start();
  env.runner.tick(0);
  env.runner.requestAdvance(1000);
  assert.deepEqual(env.calls.chapter, [1]);
  assert.equal(env.runner.getState().phase, PHASE.ADVANCING);
});

test('进度 10 分钟无增长时告警一次', () => {
  const env = makeEnv({ doc: { learnedSec: 100, requiredSec: 1800 } });
  env.runner.start();
  env.runner.tick(0);
  env.runner.tick(300000);
  env.runner.tick(610000);
  assert.equal(env.calls.warns.filter((m) => m.includes('10 分钟')).length, 1);
});

test('暂停时 refresh 仍读取页面', () => {
  const env = makeEnv();
  env.runner.start();
  env.runner.pause();
  env.snap.doc.learnedSec = 120;
  env.snap.viewer = { page: 5, pageCount: 22 };
  env.runner.refresh();
  assert.equal(env.runner.getState().doc.learnedSec, 120);
  assert.equal(env.runner.getState().viewer.page, 5);
});

test('找不到章节的错误在章节出现后自动恢复', () => {
  const env = makeEnv({ activeIndex: -1, viewer: null });
  env.runner.start();
  env.runner.tick(0);
  assert.equal(env.runner.getState().phase, PHASE.ERROR);
  env.snap.activeIndex = 0;
  env.snap.viewer = { page: 1, pageCount: 22 };
  env.runner.tick(1000);
  assert.equal(env.runner.getState().phase, PHASE.RUNNING);
});

test('切换中途开启演练模式后重试不点击', () => {
  const env = makeEnv({ doc: { learnedSec: 1800, requiredSec: 1800 } });
  env.setSwitchOnClick(false);
  env.runner.start();
  env.runner.tick(0);
  env.runner.tick(30000);
  assert.equal(env.calls.chapter.length, 1);
  env.settings.dryRun = true;
  env.runner.tick(32000);
  assert.equal(env.calls.chapter.length, 1);
  assert.ok(env.calls.logs.some((m) => m.includes('演练')));
});

test('切换验证需要 canvas，进度未重置时告警', () => {
  const env = makeEnv({ doc: { learnedSec: 1800, requiredSec: 1800 } });
  env.setSwitchOnClick(false);
  env.runner.start();
  env.runner.tick(0);
  env.runner.tick(30000);
  assert.equal(env.runner.getState().phase, PHASE.ADVANCING);
  env.snap.activeIndex = 1;
  env.snap.canvasReady = false;
  env.runner.tick(31000);
  assert.equal(env.runner.getState().phase, PHASE.ADVANCING);
  env.snap.canvasReady = true;
  env.runner.tick(33000);
  env.runner.tick(43000);
  assert.equal(env.runner.getState().phase, PHASE.RUNNING);
  assert.ok(env.calls.warns.some((m) => m.includes('未重置')));
});

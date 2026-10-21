# 实验室安全教育平台自动学习油猴脚本 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个油猴脚本，在 USTC 实验室安全教育平台学习页自动翻页、按进度切换下一章节，并在全部完成后通知。

**Architecture:** 原生 JS；`core.js` 放纯逻辑并用 node:test 覆盖，`dom.js` 只做选择器读取与白名单点击，`runner.js` 状态机通过时间戳驱动、依赖注入便于测试，`panel.js` 用 Shadow DOM 显示状态，`main.js` 负责装配、单标签页租约、通知与生命周期。

**Tech Stack:** ES2022、esbuild（唯一开发依赖）、Node.js `node:test`、Tampermonkey、Chrome/Edge。

**Spec:** `docs/superpowers/specs/2026-10-21-sysaq-auto-study-userscript-design.md`

## Global Constraints

- 自动点击白名单只有两类：章节 `li.panelItem` 与分页栏“下一页”`.pageBtn span.btn-a`；绝不点击“模拟考试/开始考试”或任何答题控件。
- 不发起任何网络请求，不读写 Cookie，不保存账号密码，不伪造鼠标/键盘/可见性事件。
- UI 文案使用中文；代码注释只在必要处使用中文。
- 默认 `enabled: false`，首次安装必须由用户手动启用。
- 时间常量固定：tick 1000ms；进度判定 5000ms；翻页 60000ms；完成确认 30000ms；切换稳定期 10000ms；结构超时 15000ms；无增长告警 600000ms；切换重试 2000/5000/10000ms；租约 TTL 15000ms，续约 5000ms。
- 所有站点选择器只能出现在 `src/selectors.js` 与只读验证片段里。
- Node.js >= 20；构建产物 `dist/sysaq-auto-study.user.js`。
- 凡涉及 `src/` 逻辑代码的提交，提交前必须 `npm test` 通过；Task 1 脚手架提交除外。不得修改全局 git 配置；如果仓库缺少提交身份，停下来向用户确认。

---

### Task 1: 项目脚手架与构建管线

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `build.mjs`
- Create: `src/config.js`
- Create: `src/selectors.js`
- Create: `src/main.js`（临时入口，Task 9 替换）
- Create: `tests/`（目录稍后使用）

**Interfaces:**
- Produces: `CONFIG`（常量对象，见下）、`SEL` / `TEXT`（选择器与文本常量）、可执行的 `npm run build`。

- [ ] **Step 1: 初始化 git 仓库与目录**

Run:
```bash
git init
mkdir -p src tests dist
git add docs/
git commit -m "docs: add design spec and implementation plan"
```
Expected: `Initialized empty Git repository`；设计文档与实现计划作为首个提交入库。

- [ ] **Step 2: 创建 `.gitignore`**

```gitignore
node_modules/
dist/
```

- [ ] **Step 3: 创建 `package.json`**

```json
{
  "name": "sysaq-auto-study",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "test": "node --test tests/"
  },
  "devDependencies": {
    "esbuild": "^0.25.0"
  }
}
```

- [ ] **Step 4: 创建 `build.mjs`**

```js
import { build } from 'esbuild';

const banner = `// ==UserScript==
// @name         实验室安全平台自动学习
// @namespace    local.sysaq
// @version      0.1.0
// @description  自动翻页、按学习进度切换下一章节
// @match        https://sysaq.ustc.edu.cn/lab-study-front/examTask/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==`;

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  outfile: 'dist/sysaq-auto-study.user.js',
  banner: { js: banner },
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'info',
});
```

- [ ] **Step 5: 创建 `src/config.js`**

```js
export const CONFIG = Object.freeze({
  tickMs: 1000,
  progressEvalMs: 5000,
  flipIntervalMs: 60000,
  completeGraceMs: 30000,
  settleMs: 10000,
  structureTimeoutMs: 15000,
  freezeWarnMs: 600000,
  advanceRetryDelaysMs: [2000, 5000, 10000],
  leaseTtlMs: 15000,
  leaseRenewMs: 5000,
});
```

- [ ] **Step 6: 创建 `src/selectors.js`**

```js
export const SEL = Object.freeze({
  chapters: '.m-left li.panelItem',
  activeChapter: '.m-left li.panelItem.activeitem',
  chapterTitle: '.itemTitle',
  progress: '.positionRight',
  total: '.m-center .time',
  viewer: '.pptbox',
  pageBtn: '.pageBtn',
  nextPage: '.pageBtn span.btn-a',
});

export const TEXT = Object.freeze({
  nextPage: '下一页',
});
```

- [ ] **Step 7: 创建临时 `src/main.js`**

```js
console.log('[sysaq-auto-study] boot');
```

- [ ] **Step 8: 安装依赖并验证构建**

Run:
```bash
npm install
npm run build
head -n 14 dist/sysaq-auto-study.user.js
```
Expected: 安装成功；构建输出包含 `dist/sysaq-auto-study.user.js`；文件头依次包含 `// ==UserScript==`、`@match https://sysaq.ustc.edu.cn/lab-study-front/examTask/*`、`// ==/UserScript==`。

- [ ] **Step 9: 提交**

```bash
git add .gitignore package.json package-lock.json build.mjs src/config.js src/selectors.js src/main.js
git commit -m "chore: scaffold userscript build pipeline"
```

---

### Task 2: 核心时长解析与完成判定

**Files:**
- Create: `src/core.js`
- Test: `tests/core.test.js`

**Interfaces:**
- Produces:
  - `parseDuration(text: string): number | null` — 支持 `m:ss`、`mm:ss`、`h:mm:ss`。
  - `formatDuration(totalSec: number): string` — `h>0` 时输出 `h:mm:ss`，否则 `mm:ss`。
  - `isComplete(learnedSec: number, requiredSec: number): boolean`。
  - `progressPercent(learnedSec: number, requiredSec: number): number`，0–100 整数。

- [ ] **Step 1: 写失败测试**

`tests/core.test.js`：
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatDuration, isComplete, progressPercent } from '../src/core.js';

test('parseDuration 解析 m:ss 与 h:mm:ss', () => {
  assert.equal(parseDuration('12:01'), 721);
  assert.equal(parseDuration('30:00'), 1800);
  assert.equal(parseDuration('01:55:48'), 6948);
  assert.equal(parseDuration(' 30:00 '), 1800);
});

test('parseDuration 对非法输入返回 null', () => {
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('1:2:3:4'), null);
  assert.equal(parseDuration('12:60'), null);
  assert.equal(parseDuration(null), null);
});

test('formatDuration 输出一致格式', () => {
  assert.equal(formatDuration(721), '12:01');
  assert.equal(formatDuration(1800), '30:00');
  assert.equal(formatDuration(6948), '1:55:48');
  assert.equal(formatDuration(0), '00:00');
});

test('isComplete 只在要求时长有效且已达标时为真', () => {
  assert.equal(isComplete(1800, 1800), true);
  assert.equal(isComplete(1801, 1800), true);
  assert.equal(isComplete(1799, 1800), false);
  assert.equal(isComplete(0, 0), false);
  assert.equal(isComplete(10, 0), false);
});

test('progressPercent 限制在 0-100', () => {
  assert.equal(progressPercent(900, 1800), 50);
  assert.equal(progressPercent(0, 1800), 0);
  assert.equal(progressPercent(2000, 1800), 100);
  assert.equal(progressPercent(10, 0), 0);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/core.test.js`
Expected: FAIL，`Cannot find module '../src/core.js'`。

- [ ] **Step 3: 实现 `src/core.js`**

```js
export function parseDuration(text) {
  if (typeof text !== 'string') return null;
  const m = text.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const first = Number(m[1]);
  const second = Number(m[2]);
  const third = m[3] === undefined ? null : Number(m[3]);
  if (second > 59) return null;
  if (third !== null && third > 59) return null;
  return third === null ? first * 60 + second : first * 3600 + second * 60 + third;
}

export function formatDuration(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  return `${String(m).padStart(2, '0')}:${sec}`;
}

export function isComplete(learnedSec, requiredSec) {
  return Number.isFinite(requiredSec) && requiredSec > 0
    && Number.isFinite(learnedSec) && learnedSec >= requiredSec;
}

export function progressPercent(learnedSec, requiredSec) {
  if (!Number.isFinite(requiredSec) || requiredSec <= 0) return 0;
  const raw = Math.round((learnedSec / requiredSec) * 100);
  return Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
}
```

- [ ] **Step 4: 运行并确认通过**

Run: `node --test tests/core.test.js`
Expected: PASS，5 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/core.js tests/core.test.js
git commit -m "feat: add duration parsing and completion logic"
```

---

### Task 3: 站点文本解析器

**Files:**
- Modify: `src/core.js`
- Modify: `tests/core.test.js`

**Interfaces:**
- Produces:
  - `parseDocProgress(text): { learnedSec, requiredSec } | null` — 输入含“已学习 … 要求学习 …”。
  - `parseTotalProgress(text): { learnedSec, requiredSec } | null` — 输入含 `learned / required`。
  - `parsePageIndicator(text): { page, pageCount } | null` — 输入形如 `3 / 22`。

- [ ] **Step 1: 追加失败测试**

先将 `tests/core.test.js` 顶部导入改为：
```js
import {
  parseDuration, formatDuration, isComplete, progressPercent,
  parseDocProgress, parseTotalProgress, parsePageIndicator,
} from '../src/core.js';
```
再在文件末尾追加：
```js
test('parseDocProgress 解析已学习/要求学习', () => {
  assert.deepEqual(parseDocProgress('已学习 12:01 要求学习 30:00'), { learnedSec: 721, requiredSec: 1800 });
  assert.deepEqual(parseDocProgress('已学习12:01要求学习30:00'), { learnedSec: 721, requiredSec: 1800 });
  assert.deepEqual(parseDocProgress('已学习 1:02:03 要求学习 2:00:00'), { learnedSec: 3723, requiredSec: 7200 });
});

test('parseDocProgress 对缺失字段返回 null', () => {
  assert.equal(parseDocProgress('已学习 12:01'), null);
  assert.equal(parseDocProgress(''), null);
  assert.equal(parseDocProgress(null), null);
});

test('parseTotalProgress 解析总时长', () => {
  assert.deepEqual(parseTotalProgress('01:55:48 / 03:00:00'), { learnedSec: 6948, requiredSec: 10800 });
  assert.deepEqual(parseTotalProgress('00:00:00 / 00:00:00'), { learnedSec: 0, requiredSec: 0 });
  assert.equal(parseTotalProgress('--'), null);
});

test('parsePageIndicator 解析页码', () => {
  assert.deepEqual(parsePageIndicator('3 / 22'), { page: 3, pageCount: 22 });
  assert.deepEqual(parsePageIndicator(' 1/22 '), { page: 1, pageCount: 22 });
  assert.equal(parsePageIndicator('22 / 3'), null);
  assert.equal(parsePageIndicator(''), null);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/core.test.js`
Expected: FAIL，`parseDocProgress` 等未导出。

- [ ] **Step 3: 在 `src/core.js` 末尾追加实现**

```js
export function parseDocProgress(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/已学习\s*([\d:]+)\s*要求学习\s*([\d:]+)/);
  if (!m) return null;
  const learnedSec = parseDuration(m[1]);
  const requiredSec = parseDuration(m[2]);
  return learnedSec === null || requiredSec === null ? null : { learnedSec, requiredSec };
}

export function parseTotalProgress(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/([\d:]+)\s*\/\s*([\d:]+)/);
  if (!m) return null;
  const learnedSec = parseDuration(m[1]);
  const requiredSec = parseDuration(m[2]);
  return learnedSec === null || requiredSec === null ? null : { learnedSec, requiredSec };
}

export function parsePageIndicator(text) {
  if (typeof text !== 'string') return null;
  const m = text.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const page = Number(m[1]);
  const pageCount = Number(m[2]);
  if (page < 1 || pageCount < 1 || page > pageCount) return null;
  return { page, pageCount };
}
```

- [ ] **Step 4: 运行并确认通过**

Run: `node --test tests/core.test.js`
Expected: PASS，9 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/core.js tests/core.test.js
git commit -m "feat: parse study progress, total and page indicator"
```

---

### Task 4: 章节与翻页决策

**Files:**
- Modify: `src/core.js`
- Modify: `tests/core.test.js`

**Interfaces:**
- Produces:
  - `pickNextIndex(length, activeIndex): { kind: 'next', index } | { kind: 'end' } | { kind: 'invalid' }`。
  - `shouldFlip({ page, pageCount, lastFlipAt, now, intervalMs, running }): boolean`。

- [ ] **Step 1: 追加失败测试**

先将顶部导入改为：
```js
import {
  parseDuration, formatDuration, isComplete, progressPercent,
  parseDocProgress, parseTotalProgress, parsePageIndicator,
  pickNextIndex, shouldFlip,
} from '../src/core.js';
```
再在文件末尾追加：
```js
test('pickNextIndex 返回下一章、结束或无效', () => {
  assert.deepEqual(pickNextIndex(3, 0), { kind: 'next', index: 1 });
  assert.deepEqual(pickNextIndex(3, 1), { kind: 'next', index: 2 });
  assert.deepEqual(pickNextIndex(3, 2), { kind: 'end' });
  assert.deepEqual(pickNextIndex(3, 3), { kind: 'invalid' });
  assert.deepEqual(pickNextIndex(0, 0), { kind: 'invalid' });
  assert.deepEqual(pickNextIndex(3, -1), { kind: 'invalid' });
});

test('shouldFlip 只在运行时且未到最后一页时按间隔触发', () => {
  const base = { page: 3, pageCount: 22, lastFlipAt: 1000, now: 61000, intervalMs: 60000, running: true };
  assert.equal(shouldFlip(base), true);
  assert.equal(shouldFlip({ ...base, now: 60999 }), false);
  assert.equal(shouldFlip({ ...base, page: 22 }), false);
  assert.equal(shouldFlip({ ...base, running: false }), false);
  assert.equal(shouldFlip({ ...base, lastFlipAt: null }), false);
  assert.equal(shouldFlip({ ...base, page: null }), false);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/core.test.js`
Expected: FAIL，`pickNextIndex` 未导出。

- [ ] **Step 3: 追加实现**

```js
export function pickNextIndex(length, activeIndex) {
  if (!Number.isInteger(length) || length <= 0) return { kind: 'invalid' };
  if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= length) {
    return { kind: 'invalid' };
  }
  if (activeIndex === length - 1) return { kind: 'end' };
  return { kind: 'next', index: activeIndex + 1 };
}

export function shouldFlip({ page, pageCount, lastFlipAt, now, intervalMs, running }) {
  if (!running) return false;
  if (!Number.isInteger(page) || !Number.isInteger(pageCount)) return false;
  if (page < 1 || page >= pageCount) return false;
  if (!Number.isFinite(lastFlipAt)) return false;
  return now - lastFlipAt >= intervalMs;
}
```

- [ ] **Step 4: 运行并确认通过**

Run: `node --test tests/core.test.js`
Expected: PASS，11 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/core.js tests/core.test.js
git commit -m "feat: add chapter and page-flip decisions"
```

---

### Task 5: 设置持久化与单标签页租约

**Files:**
- Create: `src/settings.js`
- Test: `tests/settings.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_SETTINGS`、`SETTINGS_KEY`、`LEASE_KEY`。
  - `loadSettings(storage): Settings`、`saveSettings(storage, settings): void`。
  - `acquireLease(storage, tabId, nowMs, ttlMs = 15000): boolean`、`renewLease(...)`、`isLeaseOwner(...)`、`releaseLease(storage, tabId): void`。
  - `storage` 只需实现 `getItem/setItem/removeItem`。

- [ ] **Step 1: 写失败测试**

`tests/settings.test.js`：
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, LEASE_KEY,
  loadSettings, saveSettings,
  acquireLease, renewLease, isLeaseOwner, releaseLease,
} from '../src/settings.js';

function makeStorage(init = {}) {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('loadSettings 空存储返回默认值', () => {
  assert.deepEqual(loadSettings(makeStorage()), DEFAULT_SETTINGS);
});

test('loadSettings 合并部分设置并修正类型', () => {
  const storage = makeStorage({ [SETTINGS_KEY]: JSON.stringify({ enabled: true, panel: { right: 'x' }, extra: 1 }) });
  const s = loadSettings(storage);
  assert.equal(s.enabled, true);
  assert.equal(s.dryRun, false);
  assert.equal(s.panel.right, DEFAULT_SETTINGS.panel.right);
  assert.equal(s.panel.bottom, DEFAULT_SETTINGS.panel.bottom);
  assert.equal(s.extra, undefined);
});

test('loadSettings 损坏时回退默认并删除坏数据', () => {
  const storage = makeStorage({ [SETTINGS_KEY]: '{not json' });
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  assert.equal(storage.getItem(SETTINGS_KEY), null);
});

test('saveSettings 可被 loadSettings 读回', () => {
  const storage = makeStorage();
  const s = loadSettings(storage);
  s.enabled = true;
  s.panel.right = 40;
  saveSettings(storage, s);
  const round = loadSettings(storage);
  assert.equal(round.enabled, true);
  assert.equal(round.panel.right, 40);
});

test('租约：空闲可获取，被他人持有时拒绝', () => {
  const storage = makeStorage();
  assert.equal(acquireLease(storage, 'tab-a', 1000), true);
  assert.equal(isLeaseOwner(storage, 'tab-a', 1000), true);
  assert.equal(acquireLease(storage, 'tab-b', 2000), false);
  assert.equal(isLeaseOwner(storage, 'tab-b', 2000), false);
});

test('租约：过期可被接管，续约会刷新时间', () => {
  const storage = makeStorage();
  acquireLease(storage, 'tab-a', 1000);
  assert.equal(acquireLease(storage, 'tab-b', 1000 + 15001), true);
  assert.equal(isLeaseOwner(storage, 'tab-b', 17000), true);
  assert.equal(renewLease(storage, 'tab-b', 20000), true);
  assert.equal(acquireLease(storage, 'tab-a', 20001), false);
  releaseLease(storage, 'tab-b');
  assert.equal(acquireLease(storage, 'tab-a', 20002), true);
});

test('租约：损坏数据视为空闲', () => {
  const storage = makeStorage({ [LEASE_KEY]: 'broken' });
  assert.equal(acquireLease(storage, 'tab-a', 1000), true);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/settings.test.js`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `src/settings.js`**

```js
export const SETTINGS_KEY = 'sysaq-auto-study:settings:v1';
export const LEASE_KEY = 'sysaq-auto-study:lease:v1';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  dryRun: false,
  keepAwake: false,
  notify: false,
  panel: Object.freeze({ right: 16, bottom: 16, collapsed: false }),
  version: 1,
});

function defaults() {
  return { ...DEFAULT_SETTINGS, panel: { ...DEFAULT_SETTINGS.panel } };
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function loadSettings(storage) {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    const panel = parsed && typeof parsed.panel === 'object' && parsed.panel ? parsed.panel : {};
    return {
      enabled: bool(parsed.enabled, DEFAULT_SETTINGS.enabled),
      dryRun: bool(parsed.dryRun, DEFAULT_SETTINGS.dryRun),
      keepAwake: bool(parsed.keepAwake, DEFAULT_SETTINGS.keepAwake),
      notify: bool(parsed.notify, DEFAULT_SETTINGS.notify),
      panel: {
        right: finite(panel.right, DEFAULT_SETTINGS.panel.right),
        bottom: finite(panel.bottom, DEFAULT_SETTINGS.panel.bottom),
        collapsed: bool(panel.collapsed, DEFAULT_SETTINGS.panel.collapsed),
      },
      version: 1,
    };
  } catch {
    try { storage.removeItem(SETTINGS_KEY); } catch { /* ignore */ }
    return defaults();
  }
}

export function saveSettings(storage, settings) {
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
  return lease && typeof lease.tabId === 'string' && Number.isFinite(lease.ts);
}

export function isLeaseOwner(storage, tabId, nowMs, ttlMs = 15000) {
  const lease = readLease(storage);
  return Boolean(validLease(lease) && lease.tabId === tabId && nowMs - lease.ts <= ttlMs);
}

export function acquireLease(storage, tabId, nowMs, ttlMs = 15000) {
  const lease = readLease(storage);
  const free = !validLease(lease) || lease.tabId === tabId || nowMs - lease.ts > ttlMs;
  if (!free) return false;
  storage.setItem(LEASE_KEY, JSON.stringify({ tabId, ts: nowMs }));
  return true;
}

export function renewLease(storage, tabId, nowMs, ttlMs = 15000) {
  if (!isLeaseOwner(storage, tabId, nowMs, ttlMs)) return false;
  storage.setItem(LEASE_KEY, JSON.stringify({ tabId, ts: nowMs }));
  return true;
}

export function releaseLease(storage, tabId) {
  const lease = readLease(storage);
  if (validLease(lease) && lease.tabId === tabId) {
    try { storage.removeItem(LEASE_KEY); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: 运行并确认通过**

Run: `node --test tests/settings.test.js`
Expected: PASS，7 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/settings.js tests/settings.test.js
git commit -m "feat: add settings persistence and tab lease"
```

---

### Task 6: DOM 适配器

**Files:**
- Create: `src/dom.js`
- Modify: `src/main.js`（仍保持临时入口）

**Interfaces:**
- Produces:
  - `readSnapshot(): Snapshot`，其中
    `Snapshot = { ready, chapters: string[], activeIndex, doc: {learnedSec,requiredSec}|null, total: {learnedSec,requiredSec}|null, viewer: {page,pageCount}|null }`。
  - `clickChapter(index: number): boolean`。
  - `clickNextPage(): boolean`。

- [ ] **Step 1: 实现 `src/dom.js`**

```js
import { SEL, TEXT } from './selectors.js';
import { parseDocProgress, parseTotalProgress, parsePageIndicator } from './core.js';

function normalize(el) {
  return (el && el.innerText ? el.innerText : '').replace(/\s+/g, ' ').trim();
}

export function readSnapshot() {
  const chapterEls = [...document.querySelectorAll(SEL.chapters)];
  const chapters = chapterEls.map((el) => normalize(el.querySelector(SEL.chapterTitle) || el));
  const active = document.querySelector(SEL.activeChapter);
  const activeIndex = active ? chapterEls.indexOf(active) : -1;
  const doc = parseDocProgress(normalize(document.querySelector(SEL.progress)));
  const total = parseTotalProgress(normalize(document.querySelector(SEL.total)));

  let viewer = null;
  const viewerEl = document.querySelector(SEL.viewer);
  if (viewerEl) {
    const indicator = [...viewerEl.querySelectorAll(`${SEL.pageBtn} div`)]
      .find((el) => /^\s*\d+\s*\/\s*\d+\s*$/.test(normalize(el)));
    viewer = indicator ? parsePageIndicator(normalize(indicator)) : null;
  }

  return {
    ready: chapterEls.length > 0 && doc !== null,
    chapters,
    activeIndex,
    doc,
    total,
    viewer,
  };
}

export function clickChapter(index) {
  const els = [...document.querySelectorAll(SEL.chapters)];
  if (!Number.isInteger(index) || index < 0 || index >= els.length) return false;
  els[index].click();
  return true;
}

export function clickNextPage() {
  const btn = [...document.querySelectorAll(SEL.nextPage)]
    .find((el) => normalize(el) === TEXT.nextPage);
  if (!btn) return false;
  btn.click();
  return true;
}
```

- [ ] **Step 2: 在真实页面做只读验证**

在已登录且已打开任一文档的学习页，用浏览器自动化执行以下**只读**代码（不点击、不修改页面）：
```js
(() => {
  const norm = (el) => (el && el.innerText ? el.innerText : '').replace(/\s+/g, ' ').trim();
  const chapterEls = [...document.querySelectorAll('.m-left li.panelItem')];
  const active = document.querySelector('.m-left li.panelItem.activeitem');
  const viewerEl = document.querySelector('.pptbox');
  const indicator = viewerEl
    ? [...viewerEl.querySelectorAll('.pageBtn div')].find((d) => /^\s*\d+\s*\/\s*\d+\s*$/.test(norm(d)))
    : null;
  return {
    chapters: chapterEls.map((el) => norm(el.querySelector('.itemTitle') || el)),
    activeIndex: active ? chapterEls.indexOf(active) : -1,
    progress: norm(document.querySelector('.positionRight')),
    total: norm(document.querySelector('.m-center .time')),
    page: indicator ? norm(indicator) : null,
    viewer: Boolean(viewerEl),
  };
})()
```
Expected（当前实测页面）：
- `chapters` 为 3 个章节标题，例如 `通识类实验室安全知识-水电安全`；
- `activeIndex` 为 `0`（以实际高亮项为准）；
- `progress` 形如 `已学习 12:01 要求学习 30:00`；
- `total` 形如 `01:55:48 / 03:00:00`；
- `page` 形如 `1 / 22`；
- `viewer` 为 `true`。

若某项不符，先修正选择器再继续；不要点击页面上的任何按钮。

- [ ] **Step 3: 语法检查并提交**

Run:
```bash
node --check src/dom.js
git add src/dom.js
git commit -m "feat: add read-only DOM adapters"
```

---

### Task 7: 运行状态机

**Files:**
- Create: `src/runner.js`
- Create: `tests/runner.test.js`

**Interfaces:**
- Consumes: `CONFIG`；core 的 `isComplete/pickNextIndex/shouldFlip`；`dom` 端口（`readSnapshot/clickChapter/clickNextPage`）。
- Produces:
  - `PHASE`（`PAUSED/WAIT_PAGE/RUNNING/ADVANCING/COMPLETED/ERROR`）。
  - `createRunner({ dom, ui, config, getSettings, now }): { start, tick, pause, resume, requestAdvance, getState }`。
  - `ui` 端口：`render(state) / warn(msg) / error(msg) / logAction(msg) / complete()`。
  - `getState()` 字段：`phase, message, errorCode, enabled, dryRun, chapters, activeIndex, doc, total, viewer, nextTitle, canAdvance`。

- [ ] **Step 1: 写失败测试**

`tests/runner.test.js`：
```js
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
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/runner.test.js`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `src/runner.js`**

```js
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
  let snapshot = { ready: false, chapters: [], activeIndex: -1, doc: null, total: null, viewer: null };
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
      if (nowMs - advance.verifiedAt >= config.settleMs) finishAdvance();
      return;
    }
    if (snapshot.activeIndex === advance.targetIndex && snapshot.viewer) {
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
    dom.clickChapter(advance.targetIndex);
    ui.logAction(`重试切换下一章（第 ${advance.retries} 次）`);
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

  function ensureStructure(nowMs) {
    if (snapshot.ready) {
      missingSince = null;
      if (phase === PHASE.WAIT_PAGE || (phase === PHASE.ERROR && errorCode === 'structure')) {
        setPhase(PHASE.RUNNING);
      }
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
    if (phase === PHASE.PAUSED || phase === PHASE.COMPLETED) { render(); return; }
    read();
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
      const ok = settings().dryRun ? true : dom.clickNextPage();
      if (ok) {
        lastFlipAt = nowMs;
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

  return { start, tick, pause, resume, requestAdvance, getState };
}
```

- [ ] **Step 4: 运行并确认通过**

Run: `node --test tests/runner.test.js`
Expected: PASS，9 个测试全部通过。

如“学习达标后……”测试未在 `tick(35000)` 进入 `ADVANCING`，检查 `evaluate` 是否只记录 `completionReachedAt`、30 秒确认是否在 `tick` 的每秒检查中调用 `beginAdvance`，以及 `beginAdvance` 后是否立即 `render` 并返回。

- [ ] **Step 5: 全量测试并提交**

Run: `npm test`
Expected: core + settings + runner 全部 PASS。

```bash
git add src/runner.js tests/runner.test.js
git commit -m "feat: add automation state machine"
```

---

### Task 8: 浮窗 UI 与系统服务

**Files:**
- Create: `src/panel.css`
- Create: `src/panel.js`
- Create: `src/services.js`

**Interfaces:**
- Consumes: `formatDuration/progressPercent`、`PHASE` 的字符串值（面板按字符串比较，不导入 runner 以避免循环依赖）、`settings` 初始值。
- Produces:
  - `createPanel({ settings, callbacks }): { render(state), notify(text, level), destroy() }`；
  - `callbacks = { onToggle, onAdvance, onSetting(key, value), onPanelChange(patch) }`；
  - `createNotifier(): { unlock, beep(times), requestPermission(), notify(title, body) }`；
  - `createWakeLock(): { acquire(), release() }`；
  - `setTitle(prefix: string): void`。

- [ ] **Step 1: 创建 `src/panel.css`**

```css
:host { all: initial; }
* { box-sizing: border-box; }
.panel {
  position: fixed;
  z-index: 2147483647;
  width: 300px;
  background: #fff;
  color: #1f2329;
  border: 1px solid #d9dde3;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .18);
  font: 12px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow: hidden;
  user-select: none;
}
.hd {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: #f5f7fa;
  border-bottom: 1px solid #e5e8ec;
  cursor: move;
}
.hd .title { font-weight: 600; }
.hd .phase { margin-left: auto; color: #646a73; }
.hd button {
  border: 0; background: transparent; cursor: pointer;
  font-size: 14px; line-height: 1; color: #646a73; padding: 2px 4px;
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: #8f959e; }
.dot[data-phase="RUNNING"] { background: #34a853; }
.dot[data-phase="ADVANCING"] { background: #fbbc04; }
.dot[data-phase="COMPLETED"] { background: #1a73e8; }
.dot[data-phase="ERROR"] { background: #ea4335; }
.bd { padding: 10px 12px 12px; }
.row { display: flex; gap: 8px; margin: 4px 0; }
.row .k { flex: 0 0 58px; color: #8f959e; }
.row .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { height: 6px; background: #eef0f3; border-radius: 3px; overflow: hidden; margin: 6px 0 8px; }
.bar .fill { height: 100%; width: 0; background: #1a73e8; transition: width .3s; }
.msg { min-height: 18px; margin: 4px 0; color: #646a73; word-break: break-all; }
.msg.warn { color: #b06000; }
.msg.error { color: #c5221f; }
.msg.success { color: #137333; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
.actions button {
  flex: 1; padding: 6px 8px; border-radius: 6px; cursor: pointer;
  border: 1px solid #d9dde3; background: #fff; color: #1f2329;
}
.actions button:hover { background: #f5f7fa; }
.actions button:disabled { opacity: .5; cursor: default; }
.options { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; color: #646a73; }
.options label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.panel.collapsed { width: auto; }
.panel.collapsed .bd { display: none; }
.panel.collapsed .hd { border-bottom: 0; }
```

- [ ] **Step 2: 创建 `src/panel.js`**

```js
import CSS from './panel.css';
import { formatDuration, progressPercent } from './core.js';

const PHASE_LABEL = {
  PAUSED: '已暂停',
  WAIT_PAGE: '等待页面',
  RUNNING: '运行中',
  ADVANCING: '切换章节中',
  COMPLETED: '全部完成',
  ERROR: '需处理',
};

function fmt(sec) {
  return sec === null || sec === undefined ? '--:--' : formatDuration(sec);
}

export function createPanel({ settings, callbacks }) {
  const host = document.createElement('div');
  host.id = 'sysaq-auto-study-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'panel' + (settings.panel.collapsed ? ' collapsed' : '');
  root.style.right = settings.panel.right + 'px';
  root.style.bottom = settings.panel.bottom + 'px';
  root.innerHTML = `
    <div class="hd">
      <span class="dot"></span>
      <span class="title">自动学习</span>
      <span class="phase">已暂停</span>
      <button class="collapse" title="收起">－</button>
    </div>
    <div class="bd">
      <div class="row"><span class="k">当前章节</span><span class="v chapter">--</span></div>
      <div class="row"><span class="k">本文档</span><span class="v doc">--:-- / --:--</span></div>
      <div class="bar"><div class="fill"></div></div>
      <div class="row"><span class="k">总时长</span><span class="v total">--:-- / --:--</span></div>
      <div class="row"><span class="k">翻页</span><span class="v page">--</span></div>
      <div class="row"><span class="k">下一步</span><span class="v next">--</span></div>
      <div class="msg"></div>
      <div class="actions">
        <button class="toggle">启用</button>
        <button class="advance">立即跳下一章</button>
      </div>
      <div class="options">
        <label><input type="checkbox" class="dry"> 演练模式</label>
        <label><input type="checkbox" class="awake"> 屏幕常亮</label>
        <label><input type="checkbox" class="notify"> 通知</label>
      </div>
    </div>`;
  shadow.appendChild(root);
  document.documentElement.appendChild(host);

  const q = (sel) => root.querySelector(sel);
  const els = {
    dot: q('.dot'), phase: q('.phase'), chapter: q('.chapter'), doc: q('.doc'),
    fill: q('.fill'), total: q('.total'), page: q('.page'), next: q('.next'),
    msg: q('.msg'), toggle: q('.toggle'),
  };
  const dry = q('.dry');
  const awake = q('.awake');
  const notifyBox = q('.notify');
  const collapseBtn = q('.collapse');
  dry.checked = settings.dryRun;
  awake.checked = settings.keepAwake;
  notifyBox.checked = settings.notify;
  collapseBtn.textContent = root.classList.contains('collapsed') ? '＋' : '－';

  let msgTimer = null;
  let hasRun = false;

  function notify(text, level = 'info') {
    els.msg.textContent = text || '';
    els.msg.className = 'msg ' + level;
    if (msgTimer) clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(() => { els.msg.textContent = ''; els.msg.className = 'msg'; }, 8000);
  }

  function render(state) {
    if (state.phase !== 'PAUSED') hasRun = true;
    els.phase.textContent = PHASE_LABEL[state.phase] || state.phase;
    els.dot.dataset.phase = state.phase;
    els.chapter.textContent = state.chapters[state.activeIndex] || '--';

    if (state.doc) {
      els.doc.textContent = `${fmt(state.doc.learnedSec)} / ${fmt(state.doc.requiredSec)}`;
      els.fill.style.width = progressPercent(state.doc.learnedSec, state.doc.requiredSec) + '%';
    } else {
      els.doc.textContent = '--:-- / --:--';
      els.fill.style.width = '0%';
    }

    els.total.textContent = state.total
      ? `${fmt(state.total.learnedSec)} / ${fmt(state.total.requiredSec)}`
      : '--:-- / --:--';
    els.page.textContent = state.viewer
      ? `${state.viewer.page} / ${state.viewer.pageCount}`
      : '--';

    if (state.phase === 'RUNNING' && state.doc) {
      const remain = Math.max(0, state.doc.requiredSec - state.doc.learnedSec);
      els.next.textContent = remain > 0 ? `还需 ${fmt(remain)}，达标后跳章` : '等待确认后跳章';
    } else if (state.nextTitle) {
      els.next.textContent = `下一章：${state.nextTitle}`;
    } else {
      els.next.textContent = state.phase === 'COMPLETED' ? '没有下一章节' : '--';
    }

    const label = state.phase === 'COMPLETED'
      ? '已完成'
      : state.phase === 'ERROR'
        ? '重试'
        : state.phase === 'PAUSED'
          ? (hasRun ? '继续' : '启用')
          : '暂停';
    els.toggle.textContent = label;
    els.toggle.disabled = state.phase === 'COMPLETED';
    dry.checked = Boolean(state.dryRun);
  }

  els.toggle.addEventListener('click', () => callbacks.onToggle());
  q('.advance').addEventListener('click', () => callbacks.onAdvance());
  dry.addEventListener('change', () => callbacks.onSetting('dryRun', dry.checked));
  awake.addEventListener('change', () => callbacks.onSetting('keepAwake', awake.checked));
  notifyBox.addEventListener('change', () => callbacks.onSetting('notify', notifyBox.checked));

  collapseBtn.addEventListener('click', () => {
    root.classList.toggle('collapsed');
    collapseBtn.textContent = root.classList.contains('collapsed') ? '＋' : '－';
    callbacks.onPanelChange({ collapsed: root.classList.contains('collapsed') });
  });

  const hd = q('.hd');
  let drag = null;
  hd.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const rect = root.getBoundingClientRect();
    drag = {
      x: e.clientX,
      y: e.clientY,
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom,
    };
    hd.setPointerCapture(e.pointerId);
  });
  hd.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const right = Math.max(8, Math.min(window.innerWidth - 80, drag.right - (e.clientX - drag.x)));
    const bottom = Math.max(8, Math.min(window.innerHeight - 60, drag.bottom - (e.clientY - drag.y)));
    root.style.right = right + 'px';
    root.style.bottom = bottom + 'px';
  });
  hd.addEventListener('pointerup', (e) => {
    if (!drag) return;
    drag = null;
    hd.releasePointerCapture(e.pointerId);
    callbacks.onPanelChange({
      right: parseInt(root.style.right, 10) || 16,
      bottom: parseInt(root.style.bottom, 10) || 16,
    });
  });

  return {
    render,
    notify,
    destroy() {
      if (msgTimer) clearTimeout(msgTimer);
      host.remove();
    },
  };
}
```

- [ ] **Step 3: 创建 `src/services.js`**

```js
let audioCtx = null;

export function createNotifier() {
  function unlock() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { /* ignore */ }
  }

  function beep(times = 3) {
    if (!audioCtx) return;
    try {
      let t = audioCtx.currentTime;
      for (let i = 0; i < times; i += 1) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.32);
        t += 0.45;
      }
    } catch { /* ignore */ }
  }

  async function requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body }); } catch { /* ignore */ }
  }

  return { unlock, beep, requestPermission, notify };
}

export function createWakeLock() {
  let sentinel = null;

  async function acquire() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return false;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      return true;
    } catch {
      return false;
    }
  }

  async function release() {
    try { await sentinel?.release(); } catch { /* ignore */ }
    sentinel = null;
  }

  return { acquire, release };
}

export function setTitle(prefix) {
  const base = document.title.replace(/^\[[^\]]+\]\s*/, '');
  document.title = prefix ? `[${prefix}] ${base}` : base;
}
```

- [ ] **Step 4: 构建检查**

Run:
```bash
node --check src/panel.js
node --check src/services.js
npm run build
node --check dist/sysaq-auto-study.user.js
```
Expected: 两个源文件与产物语法检查均无输出；构建成功。注意 `main.js` 仍是临时入口，不会引用这些模块，构建仍应成功。

- [ ] **Step 5: 提交**

```bash
git add src/panel.css src/panel.js src/services.js
git commit -m "feat: add floating panel and browser services"
```

---

### Task 9: 入口装配

**Files:**
- Modify: `src/main.js`（完全替换临时入口）

**Interfaces:**
- Consumes: `CONFIG`、`settings.js`、`dom.js`、`runner.js`、`panel.js`、`services.js`。
- Produces: 浏览器可执行的完整油猴脚本入口。

- [ ] **Step 1: 替换 `src/main.js`**

```js
import { CONFIG } from './config.js';
import {
  loadSettings, saveSettings,
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
      if (pausedByLease) { pausedByLease = false; runner.resume(); }
      return true;
    }
    if (acquireLease(storage, tabId, nowMs, CONFIG.leaseTtlMs)) {
      lastLeaseRenewAt = nowMs;
      if (pausedByLease) { pausedByLease = false; runner.resume(); }
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
    if (runner.getState().phase === PHASE.COMPLETED) {
      releaseLease(storage, tabId);
      panel.render(runner.getState());
      return;
    }
    if (!settings.enabled) {
      releaseLease(storage, tabId);
      panel.render(runner.getState());
      return;
    }
    if (!leaseStep(nowMs)) {
      panel.render(runner.getState());
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

  runner.start();
  loop();
  setInterval(loop, CONFIG.tickMs);
})();
```

- [ ] **Step 2: 构建与语法检查**

Run:
```bash
npm run build
node --check dist/sysaq-auto-study.user.js
head -n 14 dist/sysaq-auto-study.user.js
```
Expected: 构建成功；语法检查通过；元数据头完整。

- [ ] **Step 3: 跑全量测试**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add src/main.js
git commit -m "feat: wire userscript entry point"
```

---

### Task 10: 安装与人工验收

**Files:**
- No source changes.

**Interfaces:**
- Consumes: `dist/sysaq-auto-study.user.js`。

- [ ] **Step 1: 最终构建**

Run:
```bash
npm test
npm run build
```
Expected: 测试全部通过，产物存在。

- [ ] **Step 2: 用户安装**

由用户在 Chrome/Edge 中：
1. 安装 Tampermonkey 扩展；
2. 打开 Tampermonkey 管理面板 → “添加新脚本”；
3. 用 `dist/sysaq-auto-study.user.js` 的内容替换模板并保存；
4. 打开学习详情页并刷新。

Expected: 右下角出现“自动学习”浮窗，默认状态“已暂停”，主按钮为“启用”。

- [ ] **Step 3: 按验收清单逐项人工验证**

1. 面板“当前章节 / 本文档 / 总时长 / 翻页”与页面一致；
2. 开启“演练模式”，等待 ≥2 个检查周期，只出现日志，不点击；
3. 关闭演练模式，点击“启用”，60 秒后自动翻一页；到最后一页不再翻；
4. 点击“立即跳下一章”，确认左侧高亮切换、进度归零、翻页计时重置；
5. 等待一篇文档自然达标，确认 30 秒确认期后自动跳章；
6. 最后一章完成后停止，出现提示音（如已开启通知则同时出现系统通知），标题带 `[已完成]`；
7. 点击“暂停”后不再翻页或跳章；
8. 刷新页面、或关闭后重新打开，确认设置与启用状态恢复；
9. 两个标签页同时打开，只有一个执行，另一个提示“另一标签页正在自动学习”；
10. 全程未点击“模拟考试/开始考试”，控制台无未捕获异常。

Expected: 10 项全部通过。若任一项失败，记录现象并修复后重跑相关单元测试与该项检查。

- [ ] **Step 4: 提交验收记录（无代码改动可跳过）**

```bash
git status
```
Expected: 工作区干净（`dist/` 被忽略）。

---

## 计划自查

- **规格覆盖**：架构（Task 1/8/9）、状态机与计时（Task 7）、文本解析（Task 2/3/4）、设置与并发（Task 5/9）、异常（Task 7/9）、测试（每任务 + Task 10）、安装（Task 10）均有对应任务。
- **占位符**：无 TBD/TODO；所有代码步骤均给出可执行内容。
- **接口一致性**：`Snapshot`、`getState()`、`ui` 端口、`callbacks` 在 Task 6–9 之间名称一致；`PHASE` 仅由 runner 导出，panel 使用字符串。
- **已知偏差**：设计文档要求“每 5 秒判定进度”，实现中 DOM 每秒读取，进度文本与冻结告警按 5 秒节流（`progressEvalMs`）；达标时刻由 5 秒评估记录，但 30 秒确认与翻页检查按每秒 tick 执行，确保准时切换；不改变验收行为。

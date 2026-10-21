import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDuration, formatDuration, isComplete, progressPercent,
  parseDocProgress, parseTotalProgress, parsePageIndicator,
  pickNextIndex, shouldFlip,
} from '../src/core.js';

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

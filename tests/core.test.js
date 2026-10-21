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

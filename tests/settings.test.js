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

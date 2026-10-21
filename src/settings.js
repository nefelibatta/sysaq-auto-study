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

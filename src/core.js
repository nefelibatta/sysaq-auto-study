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

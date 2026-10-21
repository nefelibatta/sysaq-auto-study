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

  const canvasReady = Boolean(viewerEl && viewerEl.querySelector(SEL.canvas));

  return {
    ready: chapterEls.length > 0 && doc !== null && (activeIndex < 0 || viewerEl !== null),
    chapters,
    activeIndex,
    doc,
    total,
    viewer,
    canvasReady,
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

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

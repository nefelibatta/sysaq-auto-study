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

/* global io */
// Utilidades compartidas entre el proyector y el panel.

const socket = io();

// ----- helpers de datos -----
function findMatch(state, id) { return state.matches.find(m => m.id === id) || null; }
function findPart(state, id) { return state.participants.find(p => p.id === id) || null; }
function partName(state, id, useNick) {
  const p = findPart(state, id);
  if (!p) return null;
  if (useNick && p.nickname) return p.nickname;
  return p.name;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

// Formación del rack según cuántos vasos quedan (solo se muestran los que quedan):
// 6 = triángulo 3-2-1, 3 = triángulo 2-1, 2 = columna vertical, etc.
// Recibe la lista de índices que quedan y los reparte en filas.
function rackRows(indices) {
  const shapes = { 6: [3, 2, 1], 5: [3, 2], 4: [3, 1], 3: [2, 1], 2: [1, 1], 1: [1], 0: [] };
  const shape = shapes[indices.length] || [indices.length];
  const rows = []; let k = 0;
  for (const size of shape) { rows.push(indices.slice(k, k + size)); k += size; }
  return rows;
}

// ----- sonidos (sintetizados, sin archivos) -----
const Sound = (() => {
  let ctx = null;
  let enabled = true;
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function beep(freq, dur, type, when, gain) {
    if (!enabled) return;
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    const t = c.currentTime + (when || 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    setEnabled(v) { enabled = !!v; },
    start() { beep(520, 0.12, 'triangle'); beep(780, 0.14, 'triangle', 0.1); },
    win() { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.18, 'square', i * 0.09, 0.2)); },
    champion() { [523, 659, 784, 1046, 1318].forEach((f, i) => beep(f, 0.3, 'sawtooth', i * 0.13, 0.18)); },
    click() { beep(320, 0.05, 'sine', 0, 0.15); },
    tick() { beep(880, 0.07, 'square', 0, 0.22); },
    buzzer() { beep(160, 0.7, 'sawtooth', 0, 0.3); beep(120, 0.7, 'sawtooth', 0, 0.3); },
    plop() { beep(600, 0.08, 'sine', 0, 0.25); beep(300, 0.12, 'sine', 0.04, 0.2); }
  };
})();

// ----- confeti (canvas, sin librerias) -----
const Confetti = (() => {
  let canvas, ctx, parts = [], raf = null, running = false;
  const colors = ['#ff2e4d', '#b6ff2e', '#29e7ff', '#ffd23f', '#a44bff', '#ffffff'];
  function ensure() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  }
  function burst(n) {
    ensure();
    for (let i = 0; i < (n || 160); i++) {
      parts.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.3,
        vx: (Math.random() - 0.5) * 6,
        vy: 2 + Math.random() * 5,
        r: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[(Math.random() * colors.length) | 0]
      });
    }
    if (!running) loop();
  }
  function loop() {
    running = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
    });
    parts = parts.filter(p => p.y < canvas.height + 40);
    if (parts.length) { raf = requestAnimationFrame(loop); }
    else { running = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
  return { burst };
})();

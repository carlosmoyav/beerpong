/* global socket, Sound, findMatch, findPart, partName, esc, rackRows */
// Panel de administracion (celular). Re-dibuja todo desde el estado en tiempo real.

const CODE = (location.pathname.split('/').pop() || '').toUpperCase();
const $ = id => document.getElementById(id);
let state = null;
let currentTab = 'matches';
let authed = false;
let joined = false;

// ---------- tema claro / oscuro ----------
const THEME_KEY = 'bp_theme';
function applyTheme(theme) {
  const light = theme === 'light';
  document.body.classList.toggle('light', light);
  const btn = $('themeBtn');
  if (btn) btn.textContent = light ? '☀️' : '🌙';
}
function initTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
  applyTheme(saved);
  const btn = $('themeBtn');
  if (btn) btn.addEventListener('click', () => {
    const now = document.body.classList.contains('light') ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, now); } catch (e) {}
    applyTheme(now);
  });
}
initTheme();

// ---------- comunicacion ----------
function emit(event, payload) {
  return new Promise(resolve => {
    socket.emit(event, payload, (res) => {
      if (res && res.ok) { resolve(res); }
      else {
        const err = res ? res.error : 'Error de conexion';
        if (err !== 'CONFIRM_CORRECTION') toast(err, 'err');
        resolve(res || { ok: false, error: err });
      }
    });
  });
}

function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind || '');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------- PIN ----------
const PIN_KEY = 'bp_pin_' + CODE;
function savedPin() { try { return localStorage.getItem(PIN_KEY); } catch (e) { return null; } }

$('pinBtn').addEventListener('click', doAuth);
$('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });

function applyAuth(pin, res, fromUser) {
  if (res && res.ok) {
    authed = true;
    try { localStorage.setItem(PIN_KEY, pin); } catch (e) {}
    $('pinGate').classList.add('hidden');
    $('admin').classList.remove('hidden');
    if (state) redraw();
  } else if (fromUser) {
    $('pinErr').textContent = 'PIN incorrecto';
  } else {
    try { localStorage.removeItem(PIN_KEY); } catch (e) {}
    authed = false;
    $('pinGate').classList.remove('hidden');
    $('admin').classList.add('hidden');
  }
}

function doAuth() {
  const pin = $('pinInput').value.trim();
  socket.emit('auth', pin, res => applyAuth(pin, res, true));
}

function logout() {
  try { localStorage.removeItem(PIN_KEY); } catch (e) {}
  authed = false;
  $('pinErr').textContent = '';
  $('pinInput').value = '';
  $('admin').classList.add('hidden');
  $('pinGate').classList.remove('hidden');
}

// Al conectar/reconectar: unirse a la sala y luego re-autenticar con el PIN guardado.
function joinAndAuth() {
  socket.emit('join', { code: CODE, role: 'admin' }, res => {
    if (!res || !res.ok) {
      joined = false;
      $('pinGate').classList.remove('hidden');
      $('admin').classList.add('hidden');
      $('pinErr').textContent = (res && res.error) || 'Torneo no encontrado.';
      return;
    }
    joined = true;
    const pin = savedPin();
    if (pin) socket.emit('auth', pin, r => applyAuth(pin, r, false));
  });
}
socket.on('connect', joinAndAuth);
if (socket.connected) joinAndAuth();

// ---------- estado ----------
function redraw() { if (!authed) return; const y = window.scrollY; draw(); window.scrollTo(0, y); }
socket.on('state', s => { state = s; redraw(); });

// ---------- tabs ----------
document.querySelectorAll('.tab-btn').forEach(b => {
  b.addEventListener('click', () => {
    currentTab = b.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(x => x.classList.toggle('active', x === b));
    draw();
  });
});

$('undoBtn').addEventListener('click', () => emit('undo'));

// ---------- dibujo principal ----------
function draw() {
  if (!state) return;
  const t = state.tournament;
  $('hName').textContent = t ? t.name : 'Sin torneo';
  $('hStatus').textContent = t ? statusText(t) : 'Crea un torneo para empezar';
  $('undoBtn').disabled = !state.canUndo;

  const v = $('view');
  if (!t) { v.innerHTML = ''; v.appendChild(viewCreate()); return; }

  let node;
  if (currentTab === 'matches') node = (t.status === 'setup') ? viewSetup() : viewMatches();
  else if (currentTab === 'players') node = viewPlayers();
  else if (currentTab === 'standings') node = viewStandings();
  else if (currentTab === 'settings') node = viewSettings();
  else node = viewHistory();

  v.innerHTML = '';
  v.appendChild(node);
}

function statusText(t) {
  const map = { setup: 'Configurando', running: 'En juego', paused: 'Pausado', finished: 'Finalizado' };
  return (map[t.status] || t.status) + ' · ' + state.participants.length + ' participantes';
}

function elFrom(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

// ---------- crear torneo ----------
function viewCreate() {
  const c = elFrom(`<div class="card stack">
    <h2>🍺 Nuevo torneo</h2>
    <div><label>Nombre del torneo</label><input id="ntName" placeholder="Cumple de..." /></div>
    <div><label>Subtítulo (opcional)</label><input id="ntSub" placeholder="Beer Pong 2026" /></div>
    <div><label>Tipo</label>
      <div class="seg" id="ntMode">
        <button data-v="individual" class="active">Individual</button>
        <button data-v="team">Por equipos</button>
      </div>
    </div>
    <button id="ntCreate" class="btn btn-primary btn-block">Crear torneo</button>
  </div>`);
  let mode = 'individual';
  c.querySelectorAll('#ntMode button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.v; c.querySelectorAll('#ntMode button').forEach(x => x.classList.toggle('active', x === b));
  }));
  c.querySelector('#ntCreate').addEventListener('click', () => {
    const name = c.querySelector('#ntName').value.trim();
    if (!name) return toast('Ponle un nombre al torneo', 'err');
    emit('createTournament', { name, subtitle: c.querySelector('#ntSub').value.trim(), mode });
  });
  return c;
}

// ---------- configuracion (antes de iniciar) ----------
function viewSetup() {
  const wrap = document.createElement('div'); wrap.className = 'stack';
  const t = state.tournament;

  const add = elFrom(`<div class="card stack">
    <h2>👥 Agregar ${t.mode === 'team' ? 'equipo' : 'jugador'}</h2>
    <div class="row">
      <input id="apName" placeholder="Nombre" />
      <button id="apBtn" class="btn btn-lime grow0">Agregar</button>
    </div>
    ${t.showNicknames ? '<input id="apNick" placeholder="Apodo (opcional)" />' : ''}
  </div>`);
  const doAdd = () => {
    const name = add.querySelector('#apName').value.trim();
    const nickEl = add.querySelector('#apNick');
    if (!name) return;
    emit('addParticipant', { name, nickname: nickEl ? nickEl.value.trim() : '' }).then(() => {
      add.querySelector('#apName').value = ''; if (nickEl) nickEl.value = '';
      add.querySelector('#apName').focus();
    });
  };
  add.querySelector('#apBtn').addEventListener('click', doAdd);
  add.querySelector('#apName').addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  wrap.appendChild(add);

  // lista
  const list = elFrom(`<div class="card"><h2>Participantes <span class="count">${state.participants.length}</span></h2><div class="plist"></div></div>`);
  const pl = list.querySelector('.plist');
  if (!state.participants.length) pl.innerHTML = '<div class="muted">Aún no hay participantes.</div>';
  state.participants.forEach(p => pl.appendChild(playerItem(p, true)));
  wrap.appendChild(list);

  // siembra + iniciar
  const start = elFrom(`<div class="card stack">
    <h2>🎲 Cruces</h2>
    <div class="seg" id="seedSeg">
      <button data-v="random">Aleatorio</button>
      <button data-v="registration">Por registro</button>
      <button data-v="manual">Manual</button>
    </div>
    <div class="hint">Manual respeta el orden de la lista de arriba (usa las flechas para reordenar).</div>
    <button id="startBtn" class="btn btn-primary btn-block">🚀 Iniciar torneo (${state.participants.length})</button>
  </div>`);
  start.querySelectorAll('#seedSeg button').forEach(b => {
    b.classList.toggle('active', b.dataset.v === t.seedingMethod);
    b.addEventListener('click', () => emit('setSeeding', { method: b.dataset.v }));
  });
  start.querySelector('#startBtn').addEventListener('click', () => {
    if (state.participants.length < 2) return toast('Se necesitan al menos 2 participantes', 'err');
    emit('startTournament').then(r => { if (r.ok) { currentTab = 'matches'; Sound.start(); } });
  });
  wrap.appendChild(start);
  return wrap;
}

function playerItem(p, editable) {
  const item = elFrom(`<div class="pitem ${p.eliminated ? 'out' : ''}">
    <div class="seed">${p.seed}</div>
    <div class="info"><div class="nm">${esc(p.name)}${p.late ? ' <span class="tag bye" style="padding:1px 6px">tarde</span>' : ''}</div>
      ${p.nickname ? `<div class="nk">"${esc(p.nickname)}"</div>` : ''}</div>
    <div class="acts"></div>
  </div>`);
  const acts = item.querySelector('.acts');
  if (editable && state.tournament.status === 'setup') {
    const up = elFrom('<button class="btn icon-btn btn-ghost">↑</button>');
    const down = elFrom('<button class="btn icon-btn btn-ghost">↓</button>');
    up.addEventListener('click', () => reorder(p.id, -1));
    down.addEventListener('click', () => reorder(p.id, 1));
    const edit = elFrom('<button class="btn icon-btn btn-ghost">✏️</button>');
    edit.addEventListener('click', () => editPlayer(p));
    const del = elFrom('<button class="btn icon-btn btn-danger">🗑</button>');
    del.addEventListener('click', () => emit('removeParticipant', { id: p.id }));
    acts.append(up, down, edit, del);
  } else {
    const wl = elFrom(`<div class="wl">${p.wins}G / ${p.losses}P</div>`);
    acts.appendChild(wl);
  }
  return item;
}

// Mueve un participante arriba/abajo en la lista (define el orden para siembra manual).
function reorder(id, dir) {
  const arr = state.participants.slice().sort((a, b) => a.seed - b.seed);
  const i = arr.findIndex(p => p.id === id);
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  emit('reorderParticipants', { order: arr.map(p => p.id) });
}

// ---------- editar jugador ----------
function editPlayer(p) {
  openModal('Editar', `
    <div class="stack">
      <div><label>Nombre</label><input id="edName" value="${esc(p.name)}" /></div>
      <div><label>Apodo</label><input id="edNick" value="${esc(p.nickname || '')}" /></div>
    </div>`, () => {
    emit('editParticipant', { id: p.id, name: $('edName').value.trim(), nickname: $('edNick').value.trim() });
    return true;
  });
}

// ---------- partidos (en marcha) ----------
function viewMatches() {
  const wrap = document.createElement('div'); wrap.className = 'stack';
  const t = state.tournament;

  if (t.status === 'finished' && t.championId) {
    const champ = elFrom(`<div class="champbar">🏆<div class="big neon-gold">${esc(partName(state, t.championId, t.showNicknames))}</div>
      <div class="muted">${t.runnerUpId ? 'Subcampeón: ' + esc(partName(state, t.runnerUpId, t.showNicknames)) : ''}</div></div>`);
    wrap.appendChild(champ);
  }

  // controles generales
  const ctrl = elFrom(`<div class="card"><div class="row">
    <button id="pauseBtn" class="btn btn-ghost">${t.status === 'paused' ? '▶︎ Reanudar' : '⏸ Pausar'}</button>
    <button id="lateBtn" class="btn btn-ghost">➕ Tardío</button>
    <button id="resetBtn" class="btn btn-danger grow0">Reiniciar</button>
  </div></div>`);
  ctrl.querySelector('#pauseBtn').addEventListener('click', () => emit(t.status === 'paused' ? 'resume' : 'pause'));
  ctrl.querySelector('#lateBtn').addEventListener('click', latePlayerFlow);
  ctrl.querySelector('#resetBtn').addEventListener('click', () => {
    openConfirm('¿Reiniciar el torneo?', 'Se borran todos los resultados. Los participantes se conservan.', () => emit('reset'));
  });
  wrap.appendChild(ctrl);

  // temporizador del partido actual
  wrap.appendChild(timerCard());

  // partidos por ronda
  const rounds = [...new Set(state.matches.map(m => m.round))].sort((a, b) => a - b);
  rounds.forEach(r => {
    const matches = state.matches.filter(m => m.round === r).sort((a, b) => a.slot - b.slot);
    const group = elFrom(`<div class="round-group card"><div class="round-title">${esc(state.roundsInfo[r] || '')}</div></div>`);
    matches.forEach(m => group.appendChild(matchCard(m)));
    wrap.appendChild(group);
  });
  return wrap;
}

// Dibuja el rack con los vasos que QUEDAN, en formación (triángulo/columna).
function rackHTML(sunk) {
  const remaining = [0, 1, 2, 3, 4, 5].filter(i => !sunk.includes(i));
  const rows = rackRows(remaining);
  if (!rows.length) return '<div class="rr"><span class="allsunk">¡6/6! 🍺</span></div>';
  return rows.map(r => '<div class="rr">' + r.map(i =>
    `<button class="cup" data-i="${i}" aria-label="Vaso"></button>`
  ).join('') + '</div>').join('');
}

function matchCard(m) {
  const t = state.tournament;
  const useNick = t.showNicknames;
  const isCurrent = m.id === t.currentMatchId && m.status !== 'finished';

  if (m.isBye || (m.status === 'finished' && !(m.aId && m.bId))) {
    const who = m.winnerId ? partName(state, m.winnerId, useNick) : '—';
    return elFrom(`<div class="match"><div class="match-top"><span class="rname">Pase automático</span>
      <span class="tag bye">BYE</span></div><div class="byebox">${esc(who)} avanza</div></div>`);
  }
  if (!(m.aId && m.bId)) {
    const a = m.aReady ? (m.aId ? partName(state, m.aId, useNick) : 'BYE') : 'Por definir';
    const b = m.bReady ? (m.bId ? partName(state, m.bId, useNick) : 'BYE') : 'Por definir';
    return elFrom(`<div class="match"><div class="tbd">${esc(a)} vs ${esc(b)}</div></div>`);
  }

  const card = elFrom(`<div class="match ${isCurrent ? 'current' : ''}">
    <div class="match-top"><span class="rname">${isCurrent ? '🔴 Jugando ahora' : ''}</span>
      <span class="tag ${m.status}">${statusLabel(m.status)}</span></div>
    <div class="wbtns"></div>
    <div class="cups"></div>
    <div class="match-actions"></div>
  </div>`);

  const wb = card.querySelector('.wbtns');
  [['a', m.aId], ['b', m.bId]].forEach(([side, pid]) => {
    const won = m.status === 'finished' && m.winnerId === pid;
    const lost = m.status === 'finished' && m.winnerId && m.winnerId !== pid;
    const btn = elFrom(`<button class="btn wbtn ${won ? 'won' : ''} ${lost ? 'lost' : ''}">${esc(partName(state, pid, useNick))}${won ? ' ✓' : ''}</button>`);
    btn.addEventListener('click', () => pickWinner(m, pid));
    wb.appendChild(btn);
  });

  // Rack de 6 vasos por lado (toca el vaso que se anotó) + botón de fallo.
  const cups = card.querySelector('.cups');
  [['a', m.aId, m.sunkA || [], m.missA || 0],
   ['b', m.bId, m.sunkB || [], m.missB || 0]].forEach(([side, pid, sunk, miss]) => {
    const lastCup = sunk.length ? sunk[sunk.length - 1] : null;
    const row = elFrom(`<div class="rackrow">
      <div class="rn"><span class="who">${esc(partName(state, pid, useNick))}</span>
        <span class="rc">${sunk.length}/6${sunk.length ? ' <button class="undo-cup" title="Deshacer último vaso">↩︎</button>' : ''}</span></div>
      <div class="rack">${rackHTML(sunk)}</div>
      <div class="missctrl">
        <span class="ml">Fallos ❌</span>
        <button class="st minus" ${miss <= 0 ? 'disabled' : ''}>−</button><b class="mv">${miss}</b><button class="st plus">+</button>
      </div>
    </div>`);
    row.querySelectorAll('.cup').forEach(cup => {
      cup.addEventListener('click', () => emit('toggleCup', { id: m.id, side, index: Number(cup.dataset.i) }));
    });
    const undoCup = row.querySelector('.undo-cup');
    if (undoCup) undoCup.addEventListener('click', () => emit('toggleCup', { id: m.id, side, index: lastCup }));
    const mc = row.querySelector('.missctrl');
    mc.querySelector('.plus').addEventListener('click', () => emit('setMiss', { id: m.id, side, d: 1 }));
    mc.querySelector('.minus').addEventListener('click', () => emit('setMiss', { id: m.id, side, d: -1 }));
    cups.appendChild(row);
  });

  const acts = card.querySelector('.match-actions');
  if (m.status !== 'finished') {
    if (!isCurrent) {
      const set = elFrom('<button class="btn btn-sm btn-ghost">Marcar como actual</button>');
      set.addEventListener('click', () => emit('setCurrentMatch', { id: m.id }));
      acts.appendChild(set);
    } else {
      const pend = elFrom('<button class="btn btn-sm btn-ghost">Volver a pendiente</button>');
      pend.addEventListener('click', () => emit('setMatchStatus', { id: m.id, status: 'pending' }));
      acts.appendChild(pend);
    }
  } else {
    const fix = elFrom('<button class="btn btn-sm btn-ghost">✏️ Corregir resultado</button>');
    fix.addEventListener('click', () => toast('Toca al ganador correcto para corregir', ''));
    acts.appendChild(fix);
  }
  return card;
}

function statusLabel(s) { return { pending: 'Pendiente', playing: 'En juego', finished: 'Finalizado' }[s] || s; }

// ---------- temporizador (panel) ----------
function adminTimerRemaining(t, m) {
  const dur = (t.timerSeconds || 0) * 1000;
  if (!m) return dur;
  if (m.tRunning && m.tEndsAt) return Math.max(0, m.tEndsAt - Date.now());
  return (m.tRemainingMs != null ? m.tRemainingMs : dur);
}

function timerCard() {
  const t = state.tournament;
  const m = t.currentMatchId ? findMatch(state, t.currentMatchId) : null;

  if (!t.timerSeconds) {
    return elFrom(`<div class="card timer-card">
      <div class="tc-top"><span class="tc-title">⏱ Temporizador</span></div>
      <div class="muted">Está en "Sin límite". Actívalo en <b>Ajustes</b> para usar la cuenta regresiva.</div>
    </div>`);
  }

  const vs = m ? (esc(partName(state, m.aId, t.showNicknames)) + ' vs ' + esc(partName(state, m.bId, t.showNicknames))) : 'Sin partido en juego';
  const running = m && m.tRunning;
  const card = elFrom(`<div class="card timer-card">
    <div class="tc-top"><span class="tc-title">⏱ Temporizador</span><span class="tc-vs">${vs}</span></div>
    <div class="tc-clock" id="timerBig">--:--</div>
    <div class="tc-btns">
      <button id="tRun" class="btn ${running ? 'btn-ghost' : 'btn-primary'} grow" ${m ? '' : 'disabled'}>${running ? '⏸ Pausar' : '▶︎ Correr'}</button>
      <button id="tReset" class="btn btn-ghost grow0" ${m ? '' : 'disabled'}>↺ Reiniciar</button>
    </div>
  </div>`);
  card.querySelector('#tRun').addEventListener('click', () => emit('timerControl', { action: running ? 'pause' : 'start' }));
  card.querySelector('#tReset').addEventListener('click', () => emit('timerControl', { action: 'reset' }));
  return card;
}

// Tic-tac local para que el reloj del panel avance sin depender del servidor.
setInterval(() => {
  const big = document.getElementById('timerBig');
  if (!big || !state || !state.tournament || !state.tournament.timerSeconds) return;
  const m = state.tournament.currentMatchId ? findMatch(state, state.tournament.currentMatchId) : null;
  const rem = adminTimerRemaining(state.tournament, m);
  big.textContent = rem <= 0 && m && m.tRunning ? '¡TIEMPO!' : fmtClock(rem);
  big.classList.toggle('low', !!(m && m.tRunning && rem <= 30000 && rem > 0));
  big.classList.toggle('up', !!(m && m.tRunning && rem <= 0));
}, 250);

function pickWinner(m, pid) {
  const fresh = findMatch(state, m.id);
  if (fresh && fresh.status === 'finished') {
    // correccion: pedir confirmacion
    openConfirm('¿Corregir el resultado?', 'Esto puede recalcular los partidos siguientes que dependan de él.',
      () => emit('setWinner', { id: m.id, winnerId: pid, confirmCorrection: true }));
  } else {
    emit('setWinner', { id: m.id, winnerId: pid }).then(r => { if (r.ok) Sound.win(); });
  }
}

// ---------- jugadores tardios ----------
function latePlayerFlow() {
  const opts = state.lateOptions || { byes: [], playin: [] };
  const canBye = opts.byes.length > 0;
  const canPlayin = opts.playin.length > 0;

  openModal('➕ Jugador / equipo tardío', `
    <div class="stack">
      <div><label>Nombre</label><input id="ltName" placeholder="Nombre" /></div>
      <div><label>Apodo (opcional)</label><input id="ltNick" /></div>
      <div class="divider"></div>
      <label>¿Cómo lo integramos?</label>
      <div class="opt-list" id="ltOpts">
        <button class="opt ${canBye ? '' : 'disabled'}" data-mode="bye" ${canBye ? '' : 'disabled'}>
          <div class="t">Asignar a un espacio libre (BYE)</div>
          <div class="d">${canBye ? opts.byes.length + ' espacio(s) disponible(s). No afecta partidos jugados.' : 'No hay espacios libres.'}</div>
        </button>
        <button class="opt ${canPlayin ? '' : 'disabled'}" data-mode="playin" ${canPlayin ? '' : 'disabled'}>
          <div class="t">Crear partido preliminar</div>
          <div class="d">${canPlayin ? 'Juega contra alguien que aún no ha jugado; el ganador toma ese lugar.' : 'No hay rivales disponibles sin afectar partidas.'}</div>
        </button>
      </div>
      <div id="ltSub"></div>
      ${(!canBye && !canPlayin) ? '<div class="warn">Ya no es posible agregar a alguien sin afectar partidos finalizados.</div>' : ''}
    </div>`, () => submitLate());

  let mode = null;
  const optsBox = $('ltOpts');
  optsBox.querySelectorAll('.opt').forEach(o => {
    if (o.disabled) return;
    o.addEventListener('click', () => {
      mode = o.dataset.mode;
      optsBox.querySelectorAll('.opt').forEach(x => x.classList.toggle('sel', x === o));
      renderLateSub(mode, opts);
    });
  });
  lateState = { mode: () => mode };
}

let lateState = null;
function renderLateSub(mode, opts) {
  const box = $('ltSub');
  if (mode === 'bye') {
    box.innerHTML = `<div class="warn" style="margin-top:10px">Se convertirá un pase automático en un partido real. Se avisará antes de reorganizar.</div>
      <label style="margin-top:10px">Espacio</label>
      <select id="ltMatch">${opts.byes.map(b => `<option value="${b.matchId}">Junto a ${esc(b.occupant)}</option>`).join('')}</select>`;
  } else if (mode === 'playin') {
    box.innerHTML = `<label style="margin-top:10px">Rival del preliminar</label>
      <select id="ltMatch">${opts.playin.map(p => `<option value="${p.matchId}|${p.id}">${esc(p.name)}</option>`).join('')}</select>`;
  } else box.innerHTML = '';
}

function submitLate() {
  const name = $('ltName').value.trim();
  const nickname = $('ltNick').value.trim();
  const mode = lateState ? lateState.mode() : null;
  if (!name) { toast('Escribe un nombre', 'err'); return false; }
  if (!mode) { toast('Elige cómo integrarlo', 'err'); return false; }
  const sel = $('ltMatch');
  if (!sel) { toast('No hay opción disponible', 'err'); return false; }
  if (mode === 'bye') {
    emit('addLatePlayer', { name, nickname, mode, matchId: sel.value });
  } else {
    const [matchId, opponentId] = sel.value.split('|');
    emit('addLatePlayer', { name, nickname, mode, matchId, opponentId });
  }
  return true;
}

// ---------- jugadores (tab) ----------
function viewPlayers() {
  if (state.tournament.status === 'setup') return viewSetup();
  const wrap = document.createElement('div'); wrap.className = 'stack';
  const list = elFrom(`<div class="card"><h2>Participantes <span class="count">${state.participants.length}</span></h2><div class="plist"></div></div>`);
  const pl = list.querySelector('.plist');
  state.participants.slice().sort((a, b) => a.seed - b.seed).forEach(p => pl.appendChild(playerItem(p, false)));
  wrap.appendChild(list);
  const lateCard = elFrom('<div class="card"><button id="lateBtn2" class="btn btn-lime btn-block">➕ Agregar jugador tardío</button></div>');
  lateCard.querySelector('#lateBtn2').addEventListener('click', latePlayerFlow);
  wrap.appendChild(lateCard);
  return wrap;
}

// ---------- posiciones ----------
function viewStandings() {
  const wrap = document.createElement('div'); wrap.className = 'stack';
  const t = state.tournament;

  const jugados = state.matches.filter(m => m.status === 'finished' && !m.isBye).length;
  const totalCopas = state.standings.reduce((s, p) => s + p.copas, 0);
  const mvp = state.standings.find(p => p.isMVP);
  const mejor = state.standings.reduce((b, p) => p.mejorPartido > (b ? b.mejorPartido : -1) ? p : b, null);

  const nm = p => esc((p.nickname && t.showNicknames) ? p.nickname : p.name);

  const stats = elFrom(`<div class="card stack">
    <h2>📊 Resumen</h2>
    <div class="statgrid">
      <div class="stat"><div class="k">Partidos jugados</div><div class="v">${jugados}</div></div>
      <div class="stat"><div class="k">🍺 Copas totales</div><div class="v">${totalCopas}</div></div>
      <div class="stat"><div class="k">🏅 MVP</div><div class="v">${mvp ? nm(mvp) : '—'}</div></div>
      <div class="stat"><div class="k">🎯 Mejor partido</div><div class="v">${mejor && mejor.mejorPartido > 0 ? nm(mejor) + ' (' + mejor.mejorPartido + ')' : '—'}</div></div>
    </div>
  </div>`);
  wrap.appendChild(stats);

  const list = elFrom('<div class="card"><h2>🏅 Posiciones</h2><div class="stack" id="stList"></div></div>');
  const sl = list.querySelector('#stList');
  state.standings.forEach((p, i) => {
    const posCls = i === 0 ? 'p1' : i === 1 ? 'p2' : i === 2 ? 'p3' : '';
    const badge = p.isChampion ? '🏆 ' : p.isRunnerUp ? '🥈 ' : '';
    const mvpTag = p.isMVP ? ' <span class="tag lime" style="padding:1px 6px">MVP</span>' : '';
    const bits = [`🍺 ${p.copas}`];
    if (p.accuracy != null) bits.push(`🎯 ${p.accuracy}%`);
    if (p.racha >= 2) bits.push(`🔥 ${p.racha}`);
    sl.appendChild(elFrom(`<div class="stand"><div class="pos ${posCls}">${i + 1}</div>
      <div class="info">
        <div class="nm">${badge}${nm(p)}${mvpTag}</div>
        <div class="substat">${bits.join(' · ')}</div>
      </div>
      <div class="wl">${p.wins}G / ${p.losses}P</div></div>`));
  });
  wrap.appendChild(list);

  const exp = elFrom('<div class="card"><button id="expBtn" class="btn btn-ghost btn-block">⬇️ Exportar resultados (CSV)</button></div>');
  exp.querySelector('#expBtn').addEventListener('click', exportCSV);
  wrap.appendChild(exp);
  return wrap;
}

function exportCSV() {
  const t = state.tournament;
  let rows = [['Posicion', 'Nombre', 'Apodo', 'Ganados', 'Perdidos', 'Jugados', 'Copas', 'Tiros', '% Acierto', 'Mejor partido', 'Mejor racha', 'MVP']];
  state.standings.forEach((p, i) => rows.push([i + 1, p.name, p.nickname || '', p.wins, p.losses, p.played,
    p.copas, p.tiros, p.accuracy != null ? p.accuracy + '%' : '', p.mejorPartido, p.mejorRacha, p.isMVP ? 'Sí' : '']));
  rows.push([]);
  rows.push(['Ronda', 'Jugador A', 'Jugador B', 'Copas A', 'Copas B', 'Ganador', 'Estado']);
  state.matches.slice().sort((a, b) => a.round - b.round || a.slot - b.slot).forEach(m => {
    rows.push([
      state.roundsInfo[m.round] || m.round,
      m.aId ? partName(state, m.aId, false) : (m.aReady ? 'BYE' : ''),
      m.bId ? partName(state, m.bId, false) : (m.bReady ? 'BYE' : ''),
      m.isBye ? '' : (m.sunkA || []).length,
      m.isBye ? '' : (m.sunkB || []).length,
      m.winnerId ? partName(state, m.winnerId, false) : '',
      statusLabel(m.status)
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (t.name || 'torneo').replace(/\s+/g, '_') + '_resultados.csv';
  a.click();
  toast('Archivo descargado', 'ok');
}

// ---------- ajustes ----------
function viewSettings() {
  const t = state.tournament;
  const wrap = document.createElement('div'); wrap.className = 'stack';

  const gen = elFrom(`<div class="card stack">
    <h2>⚙️ Ajustes</h2>
    <div class="row"><span>Sonidos</span><button id="sSound" class="btn btn-sm grow0">${t.soundEnabled ? '🔊 Activados' : '🔇 Silenciados'}</button></div>
    <div class="divider"></div>
    <div class="row"><span>Mostrar apodos</span><button id="sNick" class="btn btn-sm grow0">${t.showNicknames ? 'Sí' : 'No'}</button></div>
    <div class="divider"></div>
    <div><label>Temporizador por partido</label>
      <div class="seg" id="sTimerSeg">
        <button data-s="300">5 min</button>
        <button data-s="600">10 min</button>
        <button data-s="900">15 min</button>
        <button data-s="0">Sin límite</button>
      </div>
      <div class="row" style="margin-top:8px">
        <input id="sTimer" type="number" min="0" step="1" value="${Math.round(t.timerSeconds / 60)}" />
        <span class="grow0 muted" style="align-self:center">min</span>
        <button id="sTimerBtn" class="btn btn-sm grow0">Guardar</button>
      </div>
      <div class="hint">Cuenta regresiva visible en el proyector. 0 = sin límite.</div>
    </div>
  </div>`);
  gen.querySelector('#sSound').addEventListener('click', () => emit('setSettings', { soundEnabled: !t.soundEnabled }));
  gen.querySelector('#sNick').addEventListener('click', () => emit('setSettings', { showNicknames: !t.showNicknames }));
  gen.querySelectorAll('#sTimerSeg button').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.s) === t.timerSeconds);
    b.addEventListener('click', () => emit('setSettings', { timerSeconds: Number(b.dataset.s) }));
  });
  gen.querySelector('#sTimerBtn').addEventListener('click', () => {
    const mins = parseInt(gen.querySelector('#sTimer').value, 10);
    emit('setSettings', { timerSeconds: Math.max(0, (isNaN(mins) ? 0 : mins) * 60) });
  });
  wrap.appendChild(gen);

  const info = elFrom(`<div class="card stack">
    <h2>📺 Pantalla del proyector</h2>
    <div class="muted">Código de este torneo: <b style="color:var(--cyan);letter-spacing:2px">${esc(CODE)}</b>. En la computadora del proyector abre la página de inicio, o entra directo a <b>/p/${esc(CODE)}</b>. El QR para este panel sale con "QR panel" en esa pantalla.</div>
    <div class="divider"></div>
    <div class="row"><span>Sesión</span><button id="sLogout" class="btn btn-sm grow0">Cerrar sesión (pedir PIN)</button></div>
    <div class="hint">Este teléfono recuerda el PIN para no pedirlo cada vez que vuelves. Usa esto si quieres volver a protegerlo.</div>
  </div>`);
  info.querySelector('#sLogout').addEventListener('click', logout);
  wrap.appendChild(info);

  const danger = elFrom('<div class="card"><button id="newT" class="btn btn-danger btn-block">Crear un torneo nuevo (borra el actual)</button></div>');
  danger.querySelector('#newT').addEventListener('click', () =>
    openConfirm('¿Empezar de cero?', 'Se borra el torneo actual por completo.', () => emit('createTournament', { name: 'Torneo Beer Pong', mode: 'individual' })));
  wrap.appendChild(danger);
  return wrap;
}

// ---------- historial ----------
function viewHistory() {
  const wrap = document.createElement('div'); wrap.className = 'stack';
  const card = elFrom('<div class="card"><h2>🕘 Historial de cambios</h2><div class="stack" id="hList"></div></div>');
  const hl = card.querySelector('#hList');
  if (!state.history.length) hl.innerHTML = '<div class="muted">Sin acciones todavía.</div>';
  state.history.forEach(h => {
    const time = new Date(h.ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    hl.appendChild(elFrom(`<div class="stand"><div class="wl" style="min-width:64px">${time}</div><div class="nm" style="font-weight:600">${esc(h.action)}</div></div>`));
  });
  wrap.appendChild(card);
  return wrap;
}

// ---------- modales ----------
let modalOk = null;
function openModal(title, bodyHTML, onOk) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHTML;
  $('modal').classList.remove('hidden');
  modalOk = onOk;
  $('modalOk').textContent = 'Aceptar';
  $('modalOk').className = 'btn btn-primary';
}
function openConfirm(title, text, onOk) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = `<div class="warn">${esc(text)}</div>`;
  $('modal').classList.remove('hidden');
  modalOk = () => { onOk(); return true; };
  $('modalOk').textContent = 'Confirmar';
  $('modalOk').className = 'btn btn-danger';
}
$('modalCancel').addEventListener('click', closeModal);
$('modalOk').addEventListener('click', () => { if (!modalOk || modalOk() !== false) closeModal(); });
function closeModal() { $('modal').classList.add('hidden'); modalOk = null; }

/* global socket, Sound, Confetti, findMatch, findPart, partName, esc, fmtClock, rackRows */
// Pantalla del proyector. Solo visualiza; reacciona al estado en tiempo real.

const CODE = (location.pathname.split('/').pop() || '').toUpperCase();
const el = id => document.getElementById(id);
let last = null;
let lastChampionId = null;
let lastWinnerCount = 0;
let timerInterval = null;
let lastCountdownSec = null;
let lastSunk = { matchId: null, a: [], b: [] };

// Unirse a la sala al conectar y reconectar.
function joinRoom() {
  socket.emit('join', { code: CODE, role: 'projector' }, res => {
    if (!res || !res.ok) {
      el('empty').classList.remove('hidden');
      el('app').classList.add('hidden');
      el('empty').querySelector('p').textContent = (res && res.error) || 'Torneo no encontrado.';
      el('showQrEmpty').style.display = 'none';
    }
  });
}
socket.on('connect', joinRoom);
if (socket.connected) joinRoom();
el('roomCode').textContent = 'Código ' + CODE;

socket.on('state', render);

// ----- controles de la pantalla -----
el('fsBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
el('qrBtn').addEventListener('click', openQR);
el('showQrEmpty').addEventListener('click', openQR);
el('qrClose').addEventListener('click', () => el('qrModal').classList.add('hidden'));
el('champClose').addEventListener('click', () => el('championScreen').classList.add('hidden'));

async function openQR() {
  try {
    const r = await fetch('/api/qr?code=' + encodeURIComponent(CODE));
    const d = await r.json();
    el('qrImg').src = d.dataUrl;
    el('qrUrl').textContent = d.url;
    el('qrModal').classList.remove('hidden');
  } catch (e) { alert('No se pudo generar el QR'); }
}

// ----- render principal -----
function render(state) {
  const useNick = state.tournament ? state.tournament.showNicknames : true;
  Sound.setEnabled(state.tournament ? state.tournament.soundEnabled : true);

  if (!state.tournament || state.tournament.status === 'setup') {
    el('empty').classList.remove('hidden');
    el('app').classList.add('hidden');
    el('championScreen').classList.add('hidden');
    last = state;
    return;
  }
  el('empty').classList.add('hidden');
  el('app').classList.remove('hidden');

  const t = state.tournament;
  el('tName').textContent = t.name;
  el('tSub').textContent = t.subtitle || '';

  // estado
  const pill = el('statusPill');
  const map = { running: ['playing', 'En juego'], paused: ['pending', '⏸ Pausado'], finished: ['finished', 'Finalizado'] };
  const [cls, txt] = map[t.status] || ['pending', t.status];
  pill.className = 'tag ' + cls; pill.textContent = txt;

  // ronda actual: la ronda mas baja con partidos sin terminar
  const openRounds = state.matches.filter(m => m.status !== 'finished').map(m => m.round);
  const curRound = openRounds.length ? Math.min(...openRounds) : Math.max(...state.matches.map(m => m.round));
  el('roundName').textContent = state.roundsInfo[curRound] || '—';

  renderNow(state, useNick);
  renderNext(state, useNick, curRound);
  renderLeaders(state, useNick);
  renderRecent(state, useNick);
  renderBracket(state, useNick);

  // sonido al registrarse un nuevo ganador
  const winners = state.matches.filter(m => m.status === 'finished' && !m.isBye && m.winnerId).length;
  if (last && winners > lastWinnerCount) Sound.win();
  lastWinnerCount = winners;

  // pantalla de campeon
  if (t.championId && t.championId !== lastChampionId) {
    showChampion(state, useNick);
    lastChampionId = t.championId;
  }
  if (!t.championId) { lastChampionId = null; el('championScreen').classList.add('hidden'); }

  last = state;
}

function renderNow(state, useNick) {
  const t = state.tournament;
  const m = t.currentMatchId ? findMatch(state, t.currentMatchId) : null;
  const card = el('nowCard');
  const cupsA = el('rackA'), cupsB = el('rackB');
  if (!m || m.status === 'finished' || !(m.aId && m.bId)) {
    card.style.opacity = .55;
    el('nowVs').querySelector('.a .nm').textContent = '—';
    el('nowVs').querySelector('.b .nm').textContent = '—';
    cupsA.innerHTML = ''; cupsB.innerHTML = '';
    el('nowCupsA').style.visibility = 'hidden'; el('nowCupsB').style.visibility = 'hidden';
    el('nowMeta').textContent = t.status === 'finished' ? 'Torneo finalizado' : 'Sin partido en juego';
    stopTimer();
    el('bigCountdown').classList.add('hidden');
    lastSunk = { matchId: null, a: [], b: [] };
    return;
  }
  card.style.opacity = 1;
  el('nowVs').querySelector('.a .nm').textContent = partName(state, m.aId, useNick) || '—';
  el('nowVs').querySelector('.b .nm').textContent = partName(state, m.bId, useNick) || '—';

  // racks de vasos: detecta los recién anotados para el pop-up grande
  const sameMatch = lastSunk.matchId === m.id;
  const prevA = sameMatch ? lastSunk.a : m.sunkA.slice();
  const prevB = sameMatch ? lastSunk.b : m.sunkB.slice();
  const newA = m.sunkA.filter(i => !prevA.includes(i));
  const newB = m.sunkB.filter(i => !prevB.includes(i));
  cupsA.innerHTML = prackHTML(m.sunkA);
  cupsB.innerHTML = prackHTML(m.sunkB);
  cupsA.style.visibility = 'visible'; cupsB.style.visibility = 'visible';
  el('nowCupsA').textContent = m.sunkA.length + '/6';
  el('nowCupsB').textContent = m.sunkB.length + '/6';
  el('nowCupsA').style.visibility = 'visible'; el('nowCupsB').style.visibility = 'visible';
  if (last && sameMatch) {
    if (newA.length) triggerScorePop(partName(state, m.aId, useNick), prevA, newA[newA.length - 1]);
    else if (newB.length) triggerScorePop(partName(state, m.bId, useNick), prevB, newB[newB.length - 1]);
  }
  lastSunk = { matchId: m.id, a: m.sunkA.slice(), b: m.sunkB.slice() };

  // temporizador (control manual desde el panel)
  stopTimer();
  const meta = el('nowMeta');
  const roundTxt = esc(state.roundsInfo[m.round] || '');
  if (t.timerSeconds > 0) {
    const tick = () => {
      const rem = timerRemaining(t, m);
      // chip pequeño mm:ss
      const running = m.tRunning;
      const low = running && rem <= 30000 ? ' low' : '';
      const stateIcon = running ? '' : ' ⏸';
      if (rem <= 0 && running) {
        meta.innerHTML = roundTxt + ' &nbsp;·&nbsp; <span class="timer up">⏰ ¡TIEMPO!</span>';
      } else {
        meta.innerHTML = roundTxt + ' &nbsp;·&nbsp; <span class="timer' + low + '">' + fmtClock(rem) + stateIcon + '</span>';
      }
      // overlay gigante en los últimos 10 segundos (solo si corre)
      const bc = el('bigCountdown');
      if (running && rem > 0 && rem <= 10500) {
        const secs = Math.ceil(rem / 1000);
        el('bcNum').textContent = secs;
        bc.classList.remove('hidden');
        if (lastCountdownSec !== secs) { lastCountdownSec = secs; Sound.tick(); }
      } else if (running && rem <= 0) {
        bc.classList.add('hidden');
        if (lastCountdownSec !== 0) { lastCountdownSec = 0; Sound.buzzer(); }
      } else {
        bc.classList.add('hidden');
        lastCountdownSec = null;
      }
    };
    tick();
    timerInterval = setInterval(tick, 200);
  } else {
    meta.innerHTML = roundTxt;
    el('bigCountdown').classList.add('hidden');
  }
}

// Milisegundos restantes del temporizador de un partido.
function timerRemaining(t, m) {
  const dur = (t.timerSeconds || 0) * 1000;
  if (!m) return dur;
  if (m.tRunning && m.tEndsAt) return Math.max(0, m.tEndsAt - Date.now());
  return (m.tRemainingMs != null ? m.tRemainingMs : dur);
}
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

function renderLeaders(state, useNick) {
  const card = el('leadersCard');
  const top = state.standings.filter(p => p.copas > 0).slice(0, 4);
  if (!top.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  el('leadersList').innerHTML = top.map((p, i) => {
    const acc = p.accuracy != null ? ` <span class="acc">${p.accuracy}%</span>` : '';
    const fire = p.racha >= 2 ? ` <span class="fire">🔥${p.racha}</span>` : '';
    const mvp = p.isMVP ? ' <span class="mvp">MVP</span>' : '';
    return `<div class="leader"><span class="rk">${i + 1}</span>
      <span class="ln">${esc((p.nickname && useNick) ? p.nickname : p.name)}${mvp}</span>
      <span class="lc">🍺 ${p.copas}${acc}${fire}</span></div>`;
  }).join('');
}

// Rack del proyector: muestra solo los vasos que quedan, en formación.
function prackHTML(sunk) {
  const remaining = [0, 1, 2, 3, 4, 5].filter(i => !sunk.includes(i));
  const rows = rackRows(remaining);
  return rows.map(r => '<div class="prr">' + r.map(() => '<div class="pcup"></div>').join('') + '</div>').join('');
}

// Rack para el pop-up: se dibuja como estaba ANTES de anotar (incluye el vaso
// que se metió) y resalta/animar ese vaso exacto.
function popRackHTML(prevSunk, hitIndex) {
  const remainingBefore = [0, 1, 2, 3, 4, 5].filter(i => !prevSunk.includes(i));
  const rows = rackRows(remainingBefore);
  return rows.map(r => '<div class="sp-rr">' + r.map(i =>
    `<div class="sp-cup2${i === hitIndex ? ' hit' : ''}">${i === hitIndex ? '<span class="sp-ball"></span><span class="sp-splash"></span>' : ''}</div>`
  ).join('') + '</div>').join('');
}

// Muestra el pop-up grande de "¡anotó!" señalando a cuál vaso le metió.
let scorePopTimer = null;
function triggerScorePop(name, prevSunk, hitIndex) {
  const pop = el('scorePop');
  el('spRack').innerHTML = popRackHTML(prevSunk, hitIndex);
  el('spName').textContent = name || '';
  pop.classList.remove('hidden');
  pop.classList.remove('go');       // reinicia la animación
  void pop.offsetWidth;             // fuerza reflow
  pop.classList.add('go');
  Sound.plop();
  clearTimeout(scorePopTimer);
  scorePopTimer = setTimeout(() => pop.classList.add('hidden'), 1600);
}

function renderNext(state, useNick, curRound) {
  const cand = state.matches
    .filter(m => m.status !== 'finished' && m.aId && m.bId && m.id !== state.tournament.currentMatchId)
    .sort((a, b) => a.round - b.round || a.slot - b.slot)[0];
  el('nextVs').innerHTML = cand
    ? `${esc(partName(state, cand.aId, useNick))} <span style="color:var(--muted)">vs</span> ${esc(partName(state, cand.bId, useNick))}`
    : '<span style="color:var(--muted)">—</span>';
}

function renderRecent(state, useNick) {
  const done = state.matches
    .filter(m => m.status === 'finished' && !m.isBye && m.winnerId)
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
    .slice(0, 6);
  el('recentList').innerHTML = done.map(m => {
    const loserId = m.winnerId === m.aId ? m.bId : m.aId;
    const wCups = m.winnerId === m.aId ? (m.sunkA || []).length : (m.sunkB || []).length;
    const lCups = m.winnerId === m.aId ? (m.sunkB || []).length : (m.sunkA || []).length;
    const score = (wCups || lCups) ? `<span class="sc">${wCups}–${lCups}</span>` : '';
    return `<div class="recent-item"><span class="w">${esc(partName(state, m.winnerId, useNick))}</span>
      ${score}<span class="l">${esc(partName(state, loserId, useNick) || '—')}</span></div>`;
  }).join('') || '<div style="color:var(--muted);font-size:13px">Aún no hay resultados</div>';
}

function renderBracket(state, useNick) {
  const rounds = [...new Set(state.matches.map(m => m.round))].sort((a, b) => a - b);
  const html = rounds.map(r => {
    const matches = state.matches.filter(m => m.round === r).sort((a, b) => a.slot - b.slot);
    const rows = matches.map(m => matchBox(state, m, useNick)).join('');
    return `<div class="br-col"><div class="br-col-title">${esc(state.roundsInfo[r] || '')}</div>${rows}</div>`;
  }).join('');
  el('bracket').innerHTML = html;
}

function matchBox(state, m, useNick) {
  const playing = m.id === state.tournament.currentMatchId && m.status !== 'finished';
  const row = (pid, ready) => {
    if (!ready && !pid) return `<div class="br-row"><span class="who" style="color:var(--muted)">Por definir</span></div>`;
    if (!pid) return `<div class="br-row"><span class="who tag bye" style="border:0;padding:0;background:none">BYE</span></div>`;
    const p = findPart(state, pid);
    const isWinner = m.status === 'finished' && m.winnerId === pid;
    const isLoser = m.status === 'finished' && m.winnerId && m.winnerId !== pid;
    const cls = isWinner ? 'winner' : (isLoser ? 'loser' : '');
    return `<div class="br-row ${cls}"><span class="seed">${p ? p.seed : ''}</span>
      <span class="who">${esc(partName(state, pid, useNick))}</span>
      ${isWinner ? '<span class="chk">✓</span>' : ''}</div>`;
  };
  const byeCls = m.isBye ? 'bye' : '';
  return `<div class="br-match ${playing ? 'playing' : ''} ${byeCls}">
    ${row(m.aId, m.aReady)}${row(m.bId, m.bReady)}</div>`;
}

function showChampion(state, useNick) {
  const t = state.tournament;
  el('champName').textContent = partName(state, t.championId, useNick) || '—';
  el('runnerName').textContent = t.runnerUpId ? ('Subcampeón: ' + (partName(state, t.runnerUpId, useNick) || '')) : '';
  const mvp = (state.standings || []).find(p => p.isMVP);
  el('champMvp').innerHTML = mvp
    ? '🍺 MVP: <b>' + esc((mvp.nickname && useNick) ? mvp.nickname : mvp.name) + '</b> — ' +
      mvp.copas + ' copas' + (mvp.accuracy != null ? ' · ' + mvp.accuracy + '% acierto' : '')
    : '';
  el('championScreen').classList.remove('hidden');
  Sound.champion();
  Confetti.burst(220);
  setTimeout(() => Confetti.burst(160), 900);
  setTimeout(() => Confetti.burst(160), 1800);
}

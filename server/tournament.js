// Motor del torneo. Contiene toda la logica de negocio.
// Cada funcion recibe y modifica el objeto "state" (participants, matches, tournament...).
// La capa de sockets se encarga de guardar y transmitir el estado.

const { nextPow2, seedSlots, totalRounds, roundName } = require('./bracket');

// ---------- utilidades internas ----------

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

function now() {
  return Date.now();
}

function findMatch(state, id) {
  return state.matches.find(m => m.id === id) || null;
}

function findPart(state, id) {
  return state.participants.find(p => p.id === id) || null;
}

function log(state, action) {
  state.history.unshift({ id: uid('h'), action, ts: now() });
  if (state.history.length > 60) state.history.length = 60;
}

// Guarda una foto del estado para poder deshacer la ultima accion.
function snapshot(state, label) {
  const snap = {
    label,
    ts: now(),
    tournament: state.tournament ? JSON.parse(JSON.stringify(state.tournament)) : null,
    participants: JSON.parse(JSON.stringify(state.participants)),
    matches: JSON.parse(JSON.stringify(state.matches))
  };
  state.undoStack.push(snap);
  if (state.undoStack.length > 25) state.undoStack.shift();
}

function undo(state) {
  const snap = state.undoStack.pop();
  if (!snap) return false;
  state.tournament = snap.tournament;
  state.participants = snap.participants;
  state.matches = snap.matches;
  log(state, 'Se deshizo: ' + snap.label);
  return true;
}

// ---------- creacion y participantes ----------

function createTournament(state, { name, subtitle, mode }) {
  state.tournament = {
    id: uid('t'),
    name: name || 'Torneo Beer Pong',
    subtitle: subtitle || '',
    mode: mode === 'team' ? 'team' : 'individual',
    status: 'setup',          // setup | running | paused | finished
    seedingMethod: 'random',  // random | registration | manual
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
    currentMatchId: null,
    championId: null,
    runnerUpId: null,
    soundEnabled: true,
    showNicknames: true,
    timerSeconds: 600         // 10 min por partido (0 = sin temporizador)
  };
  state.participants = [];
  state.matches = [];
  state.history = [];
  state.undoStack = [];
  log(state, 'Torneo creado: ' + state.tournament.name);
}

function addParticipant(state, { name, nickname }) {
  if (!state.tournament) throw new Error('Primero crea un torneo.');
  if (state.tournament.status !== 'setup') {
    throw new Error('El torneo ya inicio. Usa "jugador tardio" para agregar.');
  }
  const clean = (name || '').trim();
  if (!clean) throw new Error('El nombre no puede estar vacio.');
  snapshot(state, 'Agregar participante');
  state.participants.push({
    id: uid('p'),
    name: clean,
    nickname: (nickname || '').trim(),
    seed: state.participants.length + 1,
    eliminated: false,
    late: false,
    wins: 0,
    losses: 0,
    played: 0
  });
  log(state, 'Se agrego a ' + clean);
}

function editParticipant(state, { id, name, nickname }) {
  const p = findPart(state, id);
  if (!p) throw new Error('Participante no encontrado.');
  snapshot(state, 'Editar participante');
  if (typeof name === 'string' && name.trim()) p.name = name.trim();
  if (typeof nickname === 'string') p.nickname = nickname.trim();
  log(state, 'Se edito a ' + p.name);
}

function removeParticipant(state, { id }) {
  if (!state.tournament || state.tournament.status !== 'setup') {
    throw new Error('Solo se pueden eliminar participantes antes de iniciar.');
  }
  const p = findPart(state, id);
  if (!p) return;
  snapshot(state, 'Eliminar participante');
  state.participants = state.participants.filter(x => x.id !== id);
  state.participants.forEach((x, i) => { x.seed = i + 1; });
  log(state, 'Se elimino a ' + p.name);
}

function reorderParticipants(state, { order }) {
  if (!state.tournament || state.tournament.status !== 'setup') return;
  if (!Array.isArray(order)) return;
  const byId = {};
  state.participants.forEach(p => { byId[p.id] = p; });
  const reordered = order.map(id => byId[id]).filter(Boolean);
  // Agrega cualquiera que faltara al final, por seguridad.
  state.participants.forEach(p => { if (!order.includes(p.id)) reordered.push(p); });
  reordered.forEach((p, i) => { p.seed = i + 1; });
  state.participants = reordered;
  state.tournament.seedingMethod = 'manual';
}

function setSeeding(state, { method }) {
  if (!state.tournament) return;
  if (['random', 'registration', 'manual'].includes(method)) {
    state.tournament.seedingMethod = method;
  }
}

function setSettings(state, patch) {
  if (!state.tournament) return;
  const t = state.tournament;
  if (typeof patch.soundEnabled === 'boolean') t.soundEnabled = patch.soundEnabled;
  if (typeof patch.showNicknames === 'boolean') t.showNicknames = patch.showNicknames;
  if (typeof patch.timerSeconds === 'number' && patch.timerSeconds >= 0) {
    t.timerSeconds = Math.min(patch.timerSeconds, 3600);
  }
}

// ---------- generacion de llaves ----------

function assignSeeds(state) {
  const method = state.tournament.seedingMethod;
  let list = state.participants.slice();
  if (method === 'random') {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  // 'registration' -> mantiene el orden actual.
  // 'manual' -> respeta el "seed" que el admin ya definio (ordenamos por seed).
  if (method === 'manual') {
    list.sort((a, b) => a.seed - b.seed);
  }
  list.forEach((p, i) => { p.seed = i + 1; });
}

function linkMatches(matches, size) {
  const rounds = totalRounds(size);
  const byRound = {};
  for (const m of matches) {
    (byRound[m.round] = byRound[m.round] || []).push(m);
  }
  for (let r = 1; r < rounds; r++) {
    const cur = byRound[r].sort((a, b) => a.slot - b.slot);
    const next = byRound[r + 1].sort((a, b) => a.slot - b.slot);
    cur.forEach((m, j) => {
      m.nextMatchId = next[Math.floor(j / 2)].id;
      m.nextSlot = (j % 2 === 0) ? 'a' : 'b';
    });
  }
}

function startTournament(state) {
  if (!state.tournament) throw new Error('No hay torneo.');
  if (state.participants.length < 2) throw new Error('Se necesitan al menos 2 participantes.');
  if (state.tournament.status !== 'setup') throw new Error('El torneo ya inicio.');

  snapshot(state, 'Iniciar torneo');
  assignSeeds(state);

  const N = state.participants.length;
  const size = nextPow2(N);
  const rounds = totalRounds(size);
  const slots = seedSlots(size); // seed en cada posicion del cuadro
  const seedToPart = {};
  state.participants.forEach(p => { seedToPart[p.seed] = p.id; });

  const matches = [];
  // Ronda 1
  const firstRoundMatches = size / 2;
  for (let j = 0; j < firstRoundMatches; j++) {
    const seedA = slots[j * 2];
    const seedB = slots[j * 2 + 1];
    const aId = seedToPart[seedA] || null; // null = bye
    const bId = seedToPart[seedB] || null;
    matches.push(newMatch(1, j, aId, bId, true, true));
  }
  // Rondas siguientes (vacias por ahora)
  for (let r = 2; r <= rounds; r++) {
    const count = size / Math.pow(2, r);
    for (let j = 0; j < count; j++) {
      matches.push(newMatch(r, j, null, null, false, false));
    }
  }

  state.matches = matches;
  linkMatches(state.matches, size);
  resolveByes(state); // avanza automaticamente los byes

  state.tournament.status = 'running';
  state.tournament.startedAt = now();
  autoPickCurrent(state);
  log(state, 'Torneo iniciado con ' + N + ' participantes');
}

function newMatch(round, slot, aId, bId, aReady, bReady) {
  return {
    id: uid('m'),
    round,
    slot,
    aId, bId,
    aReady, bReady,       // si el lado ya tiene definido su ocupante
    winnerId: null,
    status: 'pending',    // pending | playing | finished
    isBye: false,
    startedAt: null,
    finishedAt: null,
    nextMatchId: null,
    nextSlot: null,
    sunkA: [], sunkB: [],    // índices de vasos anotados (0..5), en orden de caída
    missA: 0, missB: 0,      // tiros fallados por cada lado (para el % de acierto)
    tRunning: false,         // temporizador corriendo
    tEndsAt: null,           // marca de tiempo en que llega a cero (si corre)
    tRemainingMs: null       // ms restantes cuando está pausado (null = duración completa)
  };
}

// Resuelve automaticamente los partidos donde solo hay un participante (bye).
function resolveByes(state) {
  let changed = true;
  let guard = 0;
  while (changed && guard < 1000) {
    changed = false;
    guard++;
    for (const m of state.matches) {
      if (m.status === 'finished') continue;
      if (!(m.aReady && m.bReady)) continue;
      const a = m.aId, b = m.bId;
      if (a && b) continue; // partido real: lo juega la gente
      let winner = null;
      if (a && !b) winner = a;
      else if (b && !a) winner = b;
      // (a && b) ya se descarto; (!a && !b) => winner null (doble bye)
      m.winnerId = winner;
      m.isBye = !!winner;
      m.status = 'finished';
      m.finishedAt = now();
      propagate(state, m);
      changed = true;
    }
  }
}

// Envia el ganador de un partido al siguiente.
function propagate(state, m) {
  if (!m.nextMatchId) {
    // Es la final.
    if (m.winnerId) {
      state.tournament.championId = m.winnerId;
      state.tournament.runnerUpId = (m.winnerId === m.aId) ? m.bId : m.aId;
      state.tournament.status = 'finished';
      state.tournament.finishedAt = now();
    }
    return;
  }
  const nm = findMatch(state, m.nextMatchId);
  if (!nm) return;
  if (m.nextSlot === 'a') { nm.aId = m.winnerId; nm.aReady = true; }
  else { nm.bId = m.winnerId; nm.bReady = true; }
}

// ---------- jugar partidos ----------

function setCurrentMatch(state, { id }) {
  if (!state.tournament) return;
  const m = findMatch(state, id);
  if (!m) throw new Error('Partido no encontrado.');
  if (m.status === 'finished') throw new Error('Ese partido ya termino.');
  if (!(m.aId && m.bId)) throw new Error('Ese partido aun no tiene a los dos participantes.');
  snapshot(state, 'Cambiar partido actual');
  state.tournament.currentMatchId = id;
  if (m.status === 'pending') {
    m.status = 'playing';
    if (!m.startedAt) m.startedAt = now();
  }
  log(state, 'Partido actual actualizado');
}

function setMatchStatus(state, { id, status }) {
  const m = findMatch(state, id);
  if (!m) throw new Error('Partido no encontrado.');
  if (!['pending', 'playing', 'finished'].includes(status)) return;
  if (status === 'finished') throw new Error('Marca un ganador para finalizar el partido.');
  snapshot(state, 'Cambiar estado del partido');
  m.status = status;
  if (status === 'playing' && !m.startedAt) m.startedAt = now();
  if (status === 'pending') { m.startedAt = null; }
  log(state, 'Estado del partido: ' + status);
}

// Marca o desmarca un vaso específico (0..5) de un lado. Toca de nuevo para corregir.
function toggleCup(state, { id, side, index }) {
  const m = findMatch(state, id);
  if (!m) throw new Error('Partido no encontrado.');
  if (m.isBye || !(m.aId && m.bId)) throw new Error('Ese partido no registra vasos.');
  if (side !== 'a' && side !== 'b') throw new Error('Lado inválido.');
  const i = Number(index);
  if (!(i >= 0 && i <= 5)) throw new Error('Vaso inválido.');
  const key = side === 'a' ? 'sunkA' : 'sunkB';
  const arr = m[key];
  const at = arr.indexOf(i);
  if (at >= 0) arr.splice(at, 1);   // ya estaba: se desmarca
  else arr.push(i);                 // se anota (al final, para saber cuál fue el último)
  // No se guarda snapshot: es un ajuste menor y reversible tocando de nuevo.
}

// Ajusta los tiros fallados de un lado (para el % de acierto).
function setMiss(state, { id, side, d }) {
  const m = findMatch(state, id);
  if (!m) throw new Error('Partido no encontrado.');
  if (m.isBye || !(m.aId && m.bId)) throw new Error('Ese partido no registra tiros.');
  if (side !== 'a' && side !== 'b') throw new Error('Lado inválido.');
  const key = side === 'a' ? 'missA' : 'missB';
  m[key] = Math.max(0, Math.min(99, (m[key] || 0) + (Number(d) || 0)));
}

// Control manual del temporizador de un partido: correr, pausar o reiniciar.
function timerControl(state, { id, action }) {
  const t = state.tournament;
  if (!t) throw new Error('No hay torneo.');
  const m = id ? findMatch(state, id) : (t.currentMatchId ? findMatch(state, t.currentMatchId) : null);
  if (!m) throw new Error('No hay partido para el temporizador.');
  const dur = (t.timerSeconds || 0) * 1000;

  if (action === 'start') {
    if (dur <= 0) throw new Error('El temporizador está en "Sin límite" (cámbialo en Ajustes).');
    if (!m.tRunning) {
      let rem = (m.tRemainingMs != null ? m.tRemainingMs : dur);
      if (rem <= 0) rem = dur; // si estaba en cero, reinicia
      m.tEndsAt = now() + rem;
      m.tRunning = true;
      m.tRemainingMs = null;
      if (m.status === 'pending') m.status = 'playing';
      if (!m.startedAt) m.startedAt = now();
    }
  } else if (action === 'pause') {
    if (m.tRunning) {
      m.tRemainingMs = Math.max(0, (m.tEndsAt || now()) - now());
      m.tRunning = false;
      m.tEndsAt = null;
    }
  } else if (action === 'reset') {
    m.tRunning = false;
    m.tEndsAt = null;
    m.tRemainingMs = dur;
  } else {
    throw new Error('Acción de temporizador inválida.');
  }
}

// Selecciona (o corrige) el ganador de un partido.
function setWinner(state, { id, winnerId, confirmCorrection }) {
  const m = findMatch(state, id);
  if (!m) throw new Error('Partido no encontrado.');
  if (!(m.aId && m.bId)) throw new Error('El partido aun no tiene a los dos participantes.');
  if (winnerId !== m.aId && winnerId !== m.bId) throw new Error('Ese ganador no juega este partido.');

  const isCorrection = m.status === 'finished';
  if (isCorrection && !confirmCorrection) {
    throw new Error('CONFIRM_CORRECTION'); // el cliente pedira confirmacion
  }

  snapshot(state, isCorrection ? 'Corregir resultado' : 'Marcar ganador');

  if (isCorrection) {
    revertResult(state, m); // deshace este resultado y todo lo que dependia de el
  }

  const loserId = (winnerId === m.aId) ? m.bId : m.aId;
  m.winnerId = winnerId;
  m.status = 'finished';
  m.finishedAt = now();
  m.isBye = false;

  const w = findPart(state, winnerId);
  const l = findPart(state, loserId);
  if (w) { w.wins++; w.played++; }
  if (l) { l.losses++; l.played++; l.eliminated = true; }

  propagate(state, m);
  resolveByes(state);

  if (state.tournament.currentMatchId === id) {
    state.tournament.currentMatchId = null;
    autoPickCurrent(state);
  }
  log(state, (w ? w.name : '?') + ' gano su partido');
}

// Deshace el resultado de un partido y en cascada los que dependian de el.
function revertResult(state, m) {
  const prevWinner = m.winnerId;
  const aId = m.aId, bId = m.bId;

  if (m.nextMatchId) {
    const nm = findMatch(state, m.nextMatchId);
    if (nm) {
      // Importante: primero se revierte el partido siguiente COMPLETO (mientras
      // sus dos lados siguen intactos, para poder restaurar bien a su perdedor);
      // recien despues quitamos a nuestro participante de ese lado.
      if (nm.status === 'finished') revertResult(state, nm);
      if (m.nextSlot === 'a') { nm.aId = null; nm.aReady = false; }
      else { nm.bId = null; nm.bReady = false; }
      nm.status = 'pending';
      if (state.tournament.currentMatchId === nm.id) state.tournament.currentMatchId = null;
    }
  } else {
    // Era la final.
    state.tournament.championId = null;
    state.tournament.runnerUpId = null;
    if (state.tournament.status === 'finished') state.tournament.status = 'running';
  }

  if (prevWinner) {
    const loserId = (prevWinner === aId) ? bId : aId;
    const w = findPart(state, prevWinner);
    const l = findPart(state, loserId);
    if (w) { w.wins = Math.max(0, w.wins - 1); w.played = Math.max(0, w.played - 1); }
    if (l) { l.losses = Math.max(0, l.losses - 1); l.played = Math.max(0, l.played - 1); l.eliminated = false; }
  }

  m.winnerId = null;
  m.finishedAt = null;
  m.isBye = false;
  m.status = 'pending';
}

// Elige automaticamente el proximo partido "actual" si no hay ninguno,
// y lo pone "en juego" con su hora de inicio (para que corra el temporizador).
function autoPickCurrent(state) {
  if (!state.tournament) return;
  if (state.tournament.currentMatchId) {
    const cur = findMatch(state, state.tournament.currentMatchId);
    if (cur && cur.status !== 'finished') return;
  }
  const next = state.matches
    .filter(m => m.status !== 'finished' && m.aId && m.bId)
    .sort((a, b) => a.round - b.round || a.slot - b.slot)[0];
  state.tournament.currentMatchId = next ? next.id : null;
  if (next) {
    if (next.status === 'pending') next.status = 'playing';
    if (!next.startedAt) next.startedAt = now();
  }
}

// ---------- control general ----------

function pause(state) {
  if (state.tournament && state.tournament.status === 'running') {
    state.tournament.status = 'paused';
    log(state, 'Torneo pausado');
  }
}
function resume(state) {
  if (state.tournament && state.tournament.status === 'paused') {
    state.tournament.status = 'running';
    log(state, 'Torneo reanudado');
  }
}
function reset(state) {
  if (!state.tournament) return;
  snapshot(state, 'Reiniciar torneo');
  state.matches = [];
  state.participants.forEach(p => {
    p.eliminated = false; p.wins = 0; p.losses = 0; p.played = 0;
  });
  state.tournament.status = 'setup';
  state.tournament.startedAt = null;
  state.tournament.finishedAt = null;
  state.tournament.currentMatchId = null;
  state.tournament.championId = null;
  state.tournament.runnerUpId = null;
  log(state, 'Torneo reiniciado (participantes conservados)');
}

// ---------- jugadores tardios ----------

// Devuelve las opciones disponibles para agregar a alguien tarde.
function lateOptions(state) {
  const opts = { byes: [], playin: [] };
  if (!state.tournament || state.tournament.status === 'setup') return opts;

  // Byes disponibles: partidos de ronda 1 con un solo participante,
  // cuyo participante todavia no haya jugado el siguiente partido.
  for (const m of state.matches) {
    if (m.round !== 1) continue;
    const oneEmpty = (m.aId && !m.bId) || (!m.aId && m.bId);
    if (!oneEmpty) continue;
    const occupantId = m.aId || m.bId;
    const nm = m.nextMatchId ? findMatch(state, m.nextMatchId) : null;
    const advancedButNotPlayed = !nm || nm.status !== 'finished';
    if (advancedButNotPlayed) {
      const occ = findPart(state, occupantId);
      opts.byes.push({ matchId: m.id, occupant: occ ? occ.name : '?' });
    }
  }

  // Partido preliminar: contra alguien que aun no ha jugado (partido pendiente, no iniciado).
  for (const m of state.matches) {
    if (m.round !== 1) continue;
    if (m.status !== 'pending') continue;
    if (!(m.aId && m.bId)) continue;
    [m.aId, m.bId].forEach(pid => {
      const p = findPart(state, pid);
      if (p && p.played === 0) opts.playin.push({ id: p.id, name: p.name, matchId: m.id });
    });
  }
  return opts;
}

function addLatePlayer(state, { name, nickname, mode, matchId, opponentId }) {
  if (!state.tournament) throw new Error('No hay torneo.');
  if (state.tournament.status === 'setup') throw new Error('El torneo aun no inicia; agregalo normalmente.');
  const clean = (name || '').trim();
  if (!clean) throw new Error('El nombre no puede estar vacio.');

  snapshot(state, 'Agregar jugador tardio');
  const p = {
    id: uid('p'),
    name: clean,
    nickname: (nickname || '').trim(),
    seed: state.participants.length + 1,
    eliminated: false,
    late: true,
    wins: 0, losses: 0, played: 0
  };

  if (mode === 'bye') {
    const m = findMatch(state, matchId);
    if (!m) { state.undoStack.pop(); throw new Error('Ese espacio ya no esta disponible.'); }
    // Quita el avance automatico del ocupante en el siguiente partido.
    if (m.nextMatchId) {
      const nm = findMatch(state, m.nextMatchId);
      if (nm && nm.status === 'finished') { state.undoStack.pop(); throw new Error('Ese espacio ya avanzo y no se puede usar.'); }
      if (nm) {
        if (m.nextSlot === 'a') { nm.aId = null; nm.aReady = false; }
        else { nm.bId = null; nm.bReady = false; }
      }
    }
    // Coloca al nuevo jugador en el lado vacio.
    if (!m.aId) { m.aId = p.id; m.aReady = true; }
    else { m.bId = p.id; m.bReady = true; }
    m.isBye = false;
    m.winnerId = null;
    m.finishedAt = null;
    m.status = 'pending';
    state.participants.push(p);
    autoPickCurrent(state);
    log(state, clean + ' agregado a un espacio libre');
    return;
  }

  if (mode === 'playin') {
    // Crea un partido preliminar contra un rival que aun no jugo.
    const target = findMatch(state, matchId);
    const opp = findPart(state, opponentId);
    if (!target || !opp) { state.undoStack.pop(); throw new Error('Rival no valido para el preliminar.'); }
    if (target.status !== 'pending') { state.undoStack.pop(); throw new Error('Ese partido ya inicio.'); }
    const oppSlot = (target.aId === opponentId) ? 'a' : 'b';
    // El rival ya no ocupa directamente su lugar: lo hara el ganador del preliminar.
    if (oppSlot === 'a') { target.aId = null; target.aReady = false; }
    else { target.bId = null; target.bReady = false; }

    const pre = newMatch(0, state.matches.filter(x => x.round === 0).length, opp.id, p.id, true, true);
    pre.nextMatchId = target.id;
    pre.nextSlot = oppSlot;
    state.matches.push(pre);
    state.participants.push(p);
    autoPickCurrent(state);
    log(state, 'Preliminar creado: ' + opp.name + ' vs ' + clean);
    return;
  }

  state.undoStack.pop();
  throw new Error('No hay forma segura de agregarlo sin afectar partidos ya jugados.');
}

// ---------- posiciones / estadisticas ----------

// Estadisticas de copas y rachas derivadas de los partidos (no se guardan aparte:
// se recalculan siempre desde los partidos, asi corregir un resultado las corrige).
function computeStats(state) {
  const st = {};
  state.participants.forEach(p => {
    st[p.id] = { copas: 0, tiros: 0, mejorPartido: 0, racha: 0, mejorRacha: 0 };
  });
  for (const m of state.matches) {
    if (m.isBye) continue;
    if (m.aId && st[m.aId]) {
      const c = (m.sunkA || []).length;
      st[m.aId].copas += c; st[m.aId].tiros += c + (m.missA || 0);
      if (c > st[m.aId].mejorPartido) st[m.aId].mejorPartido = c;
    }
    if (m.bId && st[m.bId]) {
      const c = (m.sunkB || []).length;
      st[m.bId].copas += c; st[m.bId].tiros += c + (m.missB || 0);
      if (c > st[m.bId].mejorPartido) st[m.bId].mejorPartido = c;
    }
  }
  // Rachas de victorias, recorriendo los partidos en orden cronologico.
  const finished = state.matches
    .filter(m => m.status === 'finished' && !m.isBye && m.winnerId && m.aId && m.bId)
    .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
  const cur = {};
  for (const m of finished) {
    const w = m.winnerId, l = (w === m.aId) ? m.bId : m.aId;
    if (st[w]) { cur[w] = (cur[w] || 0) + 1; if (cur[w] > st[w].mejorRacha) st[w].mejorRacha = cur[w]; }
    if (st[l]) { cur[l] = 0; }
  }
  state.participants.forEach(p => { st[p.id].racha = cur[p.id] || 0; });
  return st;
}

function standings(state) {
  const t = state.tournament;
  if (!t) return [];
  // "Ronda alcanzada" = la ultima ronda en la que aparecio el participante.
  const reached = {};
  for (const m of state.matches) {
    for (const pid of [m.aId, m.bId]) {
      if (!pid) continue;
      reached[pid] = Math.max(reached[pid] || 0, m.round);
    }
  }
  const stats = computeStats(state);
  const arr = state.participants.map(p => {
    const s = stats[p.id];
    // El % de acierto solo se muestra si se registraron fallos (tiros > copas);
    // si nadie lleva la cuenta de fallos, no inventamos un 100% enganoso.
    const acc = (s.tiros > s.copas) ? Math.round((s.copas / s.tiros) * 100) : null;
    return {
      id: p.id, name: p.name, nickname: p.nickname,
      wins: p.wins, losses: p.losses, played: p.played,
      eliminated: p.eliminated, reached: reached[p.id] || 0,
      isChampion: t.championId === p.id,
      isRunnerUp: t.runnerUpId === p.id,
      copas: s.copas, tiros: s.tiros, accuracy: acc,
      mejorPartido: s.mejorPartido, racha: s.racha, mejorRacha: s.mejorRacha,
      isMVP: false
    };
  });
  arr.sort((a, b) => {
    if (a.isChampion) return -1;
    if (b.isChampion) return 1;
    if (a.isRunnerUp) return -1;
    if (b.isRunnerUp) return 1;
    return b.reached - a.reached || b.wins - a.wins || a.losses - b.losses || b.copas - a.copas;
  });
  // MVP = quien mas copas hundio (desempate: mejor % y luego mas victorias).
  let mvp = null;
  arr.forEach(e => {
    if (e.copas <= 0) return;
    if (!mvp) { mvp = e; return; }
    const ea = e.accuracy == null ? -1 : e.accuracy;
    const ma = mvp.accuracy == null ? -1 : mvp.accuracy;
    if (e.copas > mvp.copas ||
        (e.copas === mvp.copas && (ea > ma || (ea === ma && e.wins > mvp.wins)))) mvp = e;
  });
  if (mvp) mvp.isMVP = true;
  return arr;
}

// Enriquecemos el estado para enviarlo a los clientes (nombres de rondas, etc.).
function decorate(state) {
  const t = state.tournament;
  const size = t && state.matches.length ? nextPow2(state.participants.length) : 0;
  const roundsInfo = {};
  if (state.matches.length) {
    const counts = {};
    state.matches.forEach(m => { counts[m.round] = (counts[m.round] || 0) + 1; });
    Object.keys(counts).forEach(r => {
      roundsInfo[r] = (Number(r) === 0) ? 'Preliminares' : roundName(counts[r]);
    });
  }
  return {
    tournament: t,
    participants: state.participants,
    matches: state.matches,
    history: state.history,
    canUndo: state.undoStack.length > 0,
    roundsInfo,
    lateOptions: lateOptions(state),
    standings: standings(state)
  };
}

module.exports = {
  createTournament, addParticipant, editParticipant, removeParticipant,
  reorderParticipants, setSeeding, setSettings, startTournament, setCurrentMatch, setMatchStatus,
  toggleCup, setMiss, setWinner, pause, resume, reset, addLatePlayer, undo,
  timerControl,
  decorate, findMatch, findPart
};

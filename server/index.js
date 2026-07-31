// Servidor web multi-sala. Cada torneo ("sala") tiene su propio código, nombre,
// PIN y QR. Sirve la página de inicio (crear torneo), la pantalla del proyector
// y el panel del celular, y sincroniza todo en tiempo real por WebSockets.
// Almacenamiento en Postgres si hay DATABASE_URL; si no, en archivos (local).

// Carga variables desde un archivo .env si existe (solo local; en la web se
// configuran en el panel del host). Loader mínimo, sin dependencias.
(function loadEnv() {
  try {
    const fs = require('fs');
    const p = require('path').join(__dirname, '..', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) { /* ignora */ }
})();

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const store = require('./store');
const { hashPin, verifyPin } = require('./auth');
const T = require('./tournament');

const PORT = process.env.PORT || 3000;
const ROOM_TTL_DAYS = Number(process.env.ROOM_TTL_DAYS || 7);   // borra torneos inactivos
const MAX_PIN_FAILS = 6;                                        // intentos antes de bloquear
const LOCK_MS = 60 * 1000;                                      // bloqueo tras muchos fallos

// Salas en memoria (working set). { code: { pinHash, state } }
let rooms = {};
// Control de intentos de PIN por sala. { code: { count, until } }
const authFails = {};

// Código de sala corto y legible (sin caracteres ambiguos como O/0/I/1).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  } while (rooms[code]);
  return code;
}

function persistAndBroadcast(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('state', T.decorate(room.state));           // instantáneo desde memoria
  store.saveRoom(code, room).catch(e => console.error('[store] guardar', code, ':', e.message));
}

function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + PORT);
  return proto + '://' + host;
}

function lanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'home.html')));
app.get('/p/:code', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'projector.html')));
app.get('/admin/:code', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

app.get('/api/health', (req, res) => res.json({ ok: true, store: store.kind, rooms: Object.keys(rooms).length }));

// Crea un torneo nuevo (sala) con nombre + PIN. Devuelve el código.
app.post('/api/create', async (req, res) => {
  try {
    const { name, subtitle, mode, pin } = req.body || {};
    const cleanName = (name || '').toString().trim().slice(0, 60);
    if (!cleanName) return res.status(400).json({ error: 'Ponle un nombre al torneo.' });
    const cleanPin = (pin || '').toString().trim();
    if (!/^\d{4,8}$/.test(cleanPin)) return res.status(400).json({ error: 'El PIN debe tener de 4 a 8 números.' });
    const code = genCode();
    const state = store.emptyState();
    T.createTournament(state, { name: cleanName, subtitle: (subtitle || '').toString().trim().slice(0, 80), mode });
    const room = { pinHash: hashPin(cleanPin), state };
    rooms[code] = room;
    await store.saveRoom(code, room);
    res.json({ code });
  } catch (e) {
    console.error('[create]', e.message);
    res.status(500).json({ error: 'No se pudo crear el torneo.' });
  }
});

// Indica si una sala existe (para "abrir con código").
app.get('/api/room/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const room = rooms[code];
  res.json({ exists: !!room, name: room ? (room.state.tournament && room.state.tournament.name) : null });
});

// QR con el enlace del panel de una sala (distinto para cada torneo).
app.get('/api/qr', async (req, res) => {
  const code = (req.query.code || '').toString().toUpperCase();
  if (!rooms[code]) return res.status(404).json({ error: 'Sala no encontrada' });
  const url = baseUrl(req) + '/admin/' + code;
  try {
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 260 });
    res.json({ url, dataUrl });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo generar el QR' });
  }
});

// ---------- WebSockets ----------

io.on('connection', (socket) => {
  socket.data.code = null;
  socket.data.isAdmin = false;

  socket.on('join', (payload, cb) => {
    const code = ((payload && payload.code) || '').toString().toUpperCase();
    if (!rooms[code]) { if (cb) cb({ ok: false, error: 'Torneo no encontrado. Revisa el código.' }); return; }
    socket.data.code = code;
    socket.data.isAdmin = false;
    socket.join(code);
    socket.emit('state', T.decorate(rooms[code].state));
    if (cb) cb({ ok: true, code });
  });

  socket.on('auth', (pin, cb) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) { if (typeof cb === 'function') cb({ ok: false, error: 'Sala no encontrada.' }); return; }
    // Bloqueo por demasiados intentos fallidos.
    const f = authFails[code];
    if (f && f.until && Date.now() < f.until) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Demasiados intentos. Espera un momento.' });
      return;
    }
    const ok = verifyPin(pin, room.pinHash);
    socket.data.isAdmin = ok;
    if (ok) {
      delete authFails[code];
    } else {
      const rec = authFails[code] || { count: 0, until: 0 };
      rec.count++;
      if (rec.count >= MAX_PIN_FAILS) { rec.until = Date.now() + LOCK_MS; rec.count = 0; }
      authFails[code] = rec;
    }
    if (typeof cb === 'function') cb({ ok });
  });

  // Envoltura para acciones administrativas: valida sala + PIN y maneja errores.
  function admin(handler) {
    return (payload, cb) => {
      const code = socket.data.code;
      const room = rooms[code];
      if (!room) { if (cb) cb({ ok: false, error: 'Sala no encontrada.' }); return; }
      if (!socket.data.isAdmin) { if (cb) cb({ ok: false, error: 'No autorizado. Ingresa el PIN.' }); return; }
      try {
        handler(room.state, payload || {});
        persistAndBroadcast(code);
        if (cb) cb({ ok: true });
      } catch (err) {
        if (cb) cb({ ok: false, error: err.message });
      }
    };
  }

  socket.on('createTournament', admin((s, p) => T.createTournament(s, p)));
  socket.on('addParticipant',   admin((s, p) => T.addParticipant(s, p)));
  socket.on('editParticipant',  admin((s, p) => T.editParticipant(s, p)));
  socket.on('removeParticipant',admin((s, p) => T.removeParticipant(s, p)));
  socket.on('reorderParticipants', admin((s, p) => T.reorderParticipants(s, p)));
  socket.on('setSeeding',       admin((s, p) => T.setSeeding(s, p)));
  socket.on('setSettings',      admin((s, p) => T.setSettings(s, p)));
  socket.on('startTournament',  admin((s) => T.startTournament(s)));
  socket.on('setCurrentMatch',  admin((s, p) => T.setCurrentMatch(s, p)));
  socket.on('setMatchStatus',   admin((s, p) => T.setMatchStatus(s, p)));
  socket.on('toggleCup',        admin((s, p) => T.toggleCup(s, p)));
  socket.on('setMiss',          admin((s, p) => T.setMiss(s, p)));
  socket.on('timerControl',     admin((s, p) => T.timerControl(s, p)));
  socket.on('setWinner',        admin((s, p) => T.setWinner(s, p)));
  socket.on('pause',            admin((s) => T.pause(s)));
  socket.on('resume',           admin((s) => T.resume(s)));
  socket.on('reset',            admin((s) => T.reset(s)));
  socket.on('addLatePlayer',    admin((s, p) => T.addLatePlayer(s, p)));
  socket.on('undo',             admin((s) => { if (!T.undo(s)) throw new Error('Nada para deshacer.'); }));
});

// Limpieza periódica de torneos inactivos.
function scheduleCleanup() {
  const run = () => {
    store.cleanup(ROOM_TTL_DAYS * 24 * 3600 * 1000)
      .then(removed => { removed.forEach(code => { delete rooms[code]; delete authFails[code]; });
        if (removed.length) console.log('[limpieza] torneos borrados:', removed.length); })
      .catch(e => console.error('[limpieza]', e.message));
  };
  setInterval(run, 6 * 3600 * 1000);   // cada 6 horas
  setTimeout(run, 30 * 1000);          // y una vez al arrancar
}

async function start() {
  try {
    await store.init();
    rooms = await store.loadAll();
  } catch (e) {
    console.error('\n[FATAL] No se pudo inicializar el almacenamiento:', e.message);
    if (store.kind === 'postgres') console.error('Revisa la variable DATABASE_URL.\n');
    process.exit(1);
  }
  scheduleCleanup();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  🍺  Torneo Beer Pong (web, multi-sala) en marcha\n');
    console.log('  Almacenamiento: ' + store.kind + '  |  Salas cargadas: ' + Object.keys(rooms).length);
    console.log('  Local:  http://localhost:' + PORT);
    console.log('  Red:    http://' + lanIP() + ':' + PORT + '\n');
    console.log('  Abre la dirección, crea un torneo (nombre + PIN) y comparte el QR.\n');
  });
}

start();

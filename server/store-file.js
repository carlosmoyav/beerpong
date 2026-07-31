// Driver de almacenamiento en ARCHIVOS (una sala por archivo JSON).
// Se usa en desarrollo local cuando no hay DATABASE_URL. En producción web
// conviene el driver de Postgres (el disco de Render/Railway es efímero).

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'rooms');
const roomFile = code => path.join(DATA_DIR, code + '.json');

async function init() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

// Devuelve { code: { pinHash, state, updatedAt } }
async function loadAll() {
  const rooms = {};
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const files = await fsp.readdir(DATA_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const code = f.replace(/\.json$/, '');
        const data = JSON.parse(await fsp.readFile(path.join(DATA_DIR, f), 'utf8'));
        rooms[code] = {
          pinHash: String(data.pinHash || ''),
          state: data.state || null,
          updatedAt: data.updatedAt || Date.now()
        };
      } catch (e) { /* ignora archivos corruptos */ }
    }
  } catch (e) {
    console.error('[store-file] No se pudieron leer las salas:', e.message);
  }
  return rooms;
}

let _tmpSeq = 0;
async function saveRoom(code, room) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const payload = { pinHash: room.pinHash, state: room.state, updatedAt: Date.now() };
  // Temporal único para evitar carreras si hay dos guardados casi simultáneos.
  const tmp = roomFile(code) + '.' + process.pid + '.' + (_tmpSeq++) + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(payload), 'utf8');
  await fsp.rename(tmp, roomFile(code));
}

async function deleteRoom(code) {
  try { await fsp.unlink(roomFile(code)); } catch (e) { /* ya no existe */ }
}

// Borra salas sin actividad por más de maxAgeMs. Devuelve los códigos borrados.
async function cleanup(maxAgeMs) {
  const removed = [];
  try {
    const files = fs.existsSync(DATA_DIR) ? await fsp.readdir(DATA_DIR) : [];
    const cutoff = Date.now() - maxAgeMs;
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const code = f.replace(/\.json$/, '');
      try {
        const data = JSON.parse(await fsp.readFile(path.join(DATA_DIR, f), 'utf8'));
        if ((data.updatedAt || 0) < cutoff) { await deleteRoom(code); removed.push(code); }
      } catch (e) { /* ignora */ }
    }
  } catch (e) { /* ignora */ }
  return removed;
}

module.exports = { init, loadAll, saveRoom, deleteRoom, cleanup, kind: 'file' };

// Driver de almacenamiento en POSTGRES (recomendado para la web).
// Guarda cada sala en una fila: código, PIN hasheado, estado (JSONB) y fechas.
// Sobrevive reinicios/redeploys (a diferencia del disco efímero de Render).

const { Pool } = require('pg');

// Neon y la mayoría de hosts requieren SSL. Permite desactivarlo con PGSSL=off.
function makePool() {
  const ssl = process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false };
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl });
}

let pool = null;

async function init() {
  pool = makePool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      code       TEXT PRIMARY KEY,
      pin_hash   TEXT NOT NULL,
      state      JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS tournaments_updated_idx ON tournaments (updated_at);');
}

// Devuelve { code: { pinHash, state, updatedAt } }
async function loadAll() {
  const rooms = {};
  const { rows } = await pool.query('SELECT code, pin_hash, state, updated_at FROM tournaments');
  for (const r of rows) {
    rooms[r.code] = { pinHash: r.pin_hash, state: r.state, updatedAt: new Date(r.updated_at).getTime() };
  }
  return rooms;
}

async function saveRoom(code, room) {
  await pool.query(
    `INSERT INTO tournaments (code, pin_hash, state, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (code) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, state = EXCLUDED.state, updated_at = now()`,
    [code, room.pinHash, JSON.stringify(room.state)]
  );
}

async function deleteRoom(code) {
  await pool.query('DELETE FROM tournaments WHERE code = $1', [code]);
}

// Borra salas sin actividad por más de maxAgeMs. Devuelve los códigos borrados.
async function cleanup(maxAgeMs) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const { rows } = await pool.query(
    'DELETE FROM tournaments WHERE updated_at < $1 RETURNING code', [cutoff]
  );
  return rows.map(r => r.code);
}

module.exports = { init, loadAll, saveRoom, deleteRoom, cleanup, kind: 'postgres' };

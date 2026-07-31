const $ = id => document.getElementById(id);

let mode = 'individual';
$('mode').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.v;
  $('mode').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
}));

async function create() {
  const name = $('name').value.trim();
  if (!name) { $('err').textContent = 'Ponle un nombre al torneo.'; $('name').focus(); return; }
  const pin = $('pin').value.trim();
  if (!/^\d{4,8}$/.test(pin)) { $('err').textContent = 'El PIN debe tener de 4 a 8 números.'; $('pin').focus(); return; }
  $('createBtn').disabled = true;
  $('err').textContent = '';
  try {
    const r = await fetch('/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, subtitle: $('sub').value.trim(), mode, pin })
    });
    const d = await r.json();
    if (!r.ok || !d.code) throw new Error(d.error || 'No se pudo crear');
    location.href = '/p/' + d.code;   // abre la pantalla del proyector
  } catch (e) {
    $('err').textContent = e.message || 'Error al crear el torneo.';
    $('createBtn').disabled = false;
  }
}

async function open() {
  const code = $('code').value.trim().toUpperCase();
  if (!code) { $('err2').textContent = 'Escribe el código.'; return; }
  $('err2').textContent = '';
  try {
    const r = await fetch('/api/room/' + code);
    const d = await r.json();
    if (d.exists) location.href = '/p/' + code;
    else $('err2').textContent = 'No existe un torneo con ese código.';
  } catch (e) {
    $('err2').textContent = 'No se pudo verificar el código.';
  }
}

$('createBtn').addEventListener('click', create);
$('pin').addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
$('openBtn').addEventListener('click', open);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') open(); });

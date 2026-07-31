// Utilidades para calcular las llaves (single elimination).

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(p, 2);
}

// Orden estandar de siembra para un cuadro de "size" posiciones.
// Devuelve el numero de semilla que va en cada posicion del cuadro,
// de modo que las mejores semillas queden separadas y reciban los "byes".
function seedSlots(size) {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const sum = seeds.length * 2 + 1;
    const next = [];
    for (const s of seeds) {
      next.push(s);
      next.push(sum - s);
    }
    seeds = next;
  }
  return seeds;
}

function totalRounds(size) {
  return Math.round(Math.log2(size));
}

// Nombre de la ronda segun cuantos partidos tiene.
function roundName(matchesInRound) {
  switch (matchesInRound) {
    case 1: return 'Final';
    case 2: return 'Semifinales';
    case 4: return 'Cuartos de Final';
    case 8: return 'Octavos de Final';
    default: return 'Ronda de ' + (matchesInRound * 2);
  }
}

module.exports = { nextPow2, seedSlots, totalRounds, roundName };

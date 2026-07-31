// Selector de almacenamiento. Usa Postgres si hay DATABASE_URL configurada
// (recomendado para la web); si no, cae a archivos para desarrollo local.

const driver = process.env.DATABASE_URL
  ? require('./store-pg')
  : require('./store-file');

function emptyState() {
  return {
    tournament: null,
    participants: [],
    matches: [],
    history: [],
    undoStack: []
  };
}

module.exports = {
  emptyState,
  kind: driver.kind,
  init: driver.init,
  loadAll: driver.loadAll,
  saveRoom: driver.saveRoom,
  deleteRoom: driver.deleteRoom,
  cleanup: driver.cleanup
};

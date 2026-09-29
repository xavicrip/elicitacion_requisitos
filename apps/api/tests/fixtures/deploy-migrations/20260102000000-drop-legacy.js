// Migración de prueba (tests/integration/deploy-migrations.test.ts): destructiva, porque
// `down` no puede reconstruir el campo eliminado.

export const destructive = true;

/** @param {import('mongodb').Db} db */
export async function up(db) {
  await db.collection('items').updateMany({}, { $unset: { legacy: '' } });
}

/** @param {import('mongodb').Db} _db */
export async function down(_db) {
  // Irreversible: los datos se recuperan restaurando el respaldo.
}

// Migración inicial: valida el mecanismo de migraciones de principio a fin (data-model.md §1).

export const destructive = false;

/** @param {import('mongodb').Db} db */
export async function up(db) {
  await db.createCollection('_platform');
  await db.collection('_platform').insertOne({ _id: 'schema', version: 1 });
}

/** @param {import('mongodb').Db} db */
export async function down(db) {
  await db.collection('_platform').drop();
}

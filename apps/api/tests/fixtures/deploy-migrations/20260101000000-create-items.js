// Migración de prueba (tests/integration/deploy-migrations.test.ts): no destructiva.

export const destructive = false;

/** @param {import('mongodb').Db} db */
export async function up(db) {
  await db.createCollection('items');
  await db.collection('items').createIndex({ sku: 1 }, { unique: true, name: 'sku_unique' });
}

/** @param {import('mongodb').Db} db */
export async function down(db) {
  await db.collection('items').drop();
}

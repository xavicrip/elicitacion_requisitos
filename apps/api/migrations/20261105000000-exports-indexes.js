// Índices de la feature 008 (specs/008-exportacion-resultados/data-model.md §Migración).
// No destructiva: `up` solo crea índices; `down` los elimina y conserva los datos.

export const destructive = false;

/** Índices de `exports`: [clave, opciones con `name`]. */
const INDEXES = [
  // Historial de un proyecto; también la cascada del proyecto (002).
  [{ projectId: 1, createdAt: -1 }, { name: 'projectId_createdAt' }],
  // Limpieza horaria: solo las exportaciones que aún tienen un archivo en el bucket.
  [
    { expiresAt: 1 },
    { name: 'expiresAt_with_file', partialFilterExpression: { fileKey: { $type: 'string' } } },
  ],
  // Como máximo una exportación en curso por proyecto y formato, también ante dos peticiones
  // simultáneas.
  [
    { projectId: 1, format: 1 },
    {
      name: 'projectId_format_active_unique',
      unique: true,
      partialFilterExpression: { status: { $in: ['pending', 'running'] } },
    },
  ],
];

/** @param {import('mongodb').Db} db */
export async function up(db) {
  await db
    .collection('exports')
    .createIndexes(INDEXES.map(([key, options]) => ({ key, ...options })));
}

/** @param {import('mongodb').Db} db */
export async function down(db) {
  for (const [, { name }] of INDEXES) {
    await db
      .collection('exports')
      .dropIndex(name)
      .catch((error) => {
        // 26: la colección no existe; 27: el índice no existe (down idempotente).
        if (error.code !== 26 && error.code !== 27) throw error;
      });
  }
}

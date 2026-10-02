// Índices de la feature 006 (specs/006-deteccion-asistida/data-model.md §Migración).
// No destructiva: `up` solo crea índices; `down` los elimina y conserva los datos.

export const destructive = false;

/** Índices por colección: [clave, opciones con `name`]. */
const INDEXES = {
  detection_jobs: [
    // Última detección de una versión.
    [{ versionId: 1, createdAt: -1 }, { name: 'versionId_createdAt' }],
    // Como máximo un job activo por versión, también ante dos peticiones simultáneas.
    [
      { versionId: 1 },
      {
        name: 'versionId_active_unique',
        unique: true,
        partialFilterExpression: { status: { $in: ['pending', 'running'] } },
      },
    ],
    // Cascada del proyecto (002).
    [{ projectId: 1 }, { name: 'projectId' }],
  ],
  activity_proposals: [
    [{ versionId: 1, status: 1 }, { name: 'versionId_status' }],
    [{ jobId: 1 }, { name: 'jobId' }],
    [{ projectId: 1 }, { name: 'projectId' }],
  ],
  transition_proposals: [
    [{ versionId: 1, status: 1 }, { name: 'versionId_status' }],
    [{ jobId: 1 }, { name: 'jobId' }],
    [{ projectId: 1 }, { name: 'projectId' }],
  ],
};

/** @param {import('mongodb').Db} db */
export async function up(db) {
  for (const [collection, indexes] of Object.entries(INDEXES)) {
    await db
      .collection(collection)
      .createIndexes(indexes.map(([key, options]) => ({ key, ...options })));
  }
}

/** @param {import('mongodb').Db} db */
export async function down(db) {
  for (const [collection, indexes] of Object.entries(INDEXES)) {
    for (const [, { name }] of indexes) {
      await db
        .collection(collection)
        .dropIndex(name)
        .catch((error) => {
          // 26: la colección no existe; 27: el índice no existe (down idempotente).
          if (error.code !== 26 && error.code !== 27) throw error;
        });
    }
  }
}

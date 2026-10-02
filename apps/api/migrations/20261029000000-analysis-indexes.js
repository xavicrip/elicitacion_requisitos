// Índices de la feature 007 (specs/007-dashboard-analitico/data-model.md §Migración).
// No destructiva: `up` solo crea índices; `down` los elimina y conserva los datos.

export const destructive = false;

/** Índices por colección: [clave, opciones con `name`]. */
const INDEXES = {
  analysis_runs: [
    // Historial y último run de un proyecto; también la cascada del proyecto (002).
    [{ projectId: 1, createdAt: -1 }, { name: 'projectId_createdAt' }],
    // Como máximo un análisis activo por proyecto, también ante dos peticiones simultáneas.
    [
      { projectId: 1 },
      {
        name: 'projectId_active_unique',
        unique: true,
        partialFilterExpression: { status: { $in: ['pending', 'running'] } },
      },
    ],
  ],
  duplicate_decisions: [
    [
      { projectId: 1, pair: 1 },
      { name: 'projectId_pair_unique', unique: true },
    ],
  ],
  insight_feedback: [[{ projectId: 1, runId: 1 }, { name: 'projectId_runId' }]],
  analysis_settings: [[{ projectId: 1 }, { name: 'projectId_unique', unique: true }]],
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

// Índices de la feature 004 (specs/004-detalles-requisitos/data-model.md §Migración).
// No destructiva: `up` solo crea índices; `down` los elimina y conserva los datos.

export const destructive = false;

/** Índices por colección: [clave, opciones con `name`]. */
const INDEXES = {
  details: [
    // Panel de una actividad (filtro por estado) y cobertura (research R7).
    [{ diagramId: 1, activityKey: 1, status: 1 }, { name: 'diagram_activity_status' }],
    // Orden del panel por votos y fecha (plan, ajuste 10).
    [
      { diagramId: 1, activityKey: 1, voteCount: -1, createdAt: -1 },
      { name: 'diagram_activity_votes' },
    ],
    [{ projectId: 1, createdAt: 1 }, { name: 'projectId_createdAt' }],
    [{ projectId: 1, status: 1 }, { name: 'projectId_status' }],
    [
      { given: 'text', when: 'text', then: 'text' },
      { name: 'scenario_text', default_language: 'spanish' },
    ],
  ],
  // Un voto por miembro y detalle, también ante votos simultáneos (research R4).
  detail_votes: [
    [
      { detailId: 1, userId: 1 },
      { name: 'detailId_userId_unique', unique: true },
    ],
    [{ projectId: 1 }, { name: 'projectId' }],
  ],
  detail_comments: [
    [{ detailId: 1, createdAt: 1 }, { name: 'detailId_createdAt' }],
    [{ projectId: 1 }, { name: 'projectId' }],
  ],
  detail_history: [
    [{ detailId: 1, rev: 1 }, { name: 'detailId_rev' }],
    // Cascada del proyecto (002).
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

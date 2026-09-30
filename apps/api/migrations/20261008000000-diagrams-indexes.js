// Índices de la feature 003 (specs/003-diagramas-canvas/data-model.md §Migración).
// No destructiva: `up` solo crea índices; `down` los elimina y conserva los datos.

export const destructive = false;

/** Índices por colección: [clave, opciones con `name`]. */
const INDEXES = {
  diagrams: [[{ projectId: 1, order: 1 }, { name: 'projectId_order' }]],
  diagram_versions: [
    [
      { diagramId: 1, number: 1 },
      { name: 'diagramId_number_unique', unique: true },
    ],
    // Como máximo una versión publicada y un borrador por diagrama; archivadas, las que sean.
    [
      { diagramId: 1 },
      {
        name: 'diagramId_published_unique',
        unique: true,
        partialFilterExpression: { status: 'published' },
      },
    ],
    [
      { diagramId: 1 },
      {
        name: 'diagramId_draft_unique',
        unique: true,
        partialFilterExpression: { status: 'draft' },
      },
    ],
    // Cascada del proyecto (002).
    [{ projectId: 1 }, { name: 'projectId' }],
  ],
  activities: [
    // `key` es estable entre versiones y única dentro de cada una; cubre también `{versionId}`.
    [
      { versionId: 1, key: 1 },
      { name: 'versionId_key_unique', unique: true },
    ],
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

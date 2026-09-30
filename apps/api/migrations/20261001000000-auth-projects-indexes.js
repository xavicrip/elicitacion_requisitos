// Índices de la feature 002 (specs/002-auth-proyectos/data-model.md §Migración).
// No destructiva: `up` solo crea índices (y, con ellos, las colecciones); `down` elimina los
// índices y conserva los datos, así que un rollback no pierde cuentas ni proyectos.

export const destructive = false;

const DAY = 24 * 60 * 60;

/** Índices por colección: [clave, opciones con `name`]. */
const INDEXES = {
  users: [[{ email: 1 }, { name: 'email_unique', unique: true }]],
  projects: [
    [{ 'members.userId': 1, lastActivityAt: -1 }, { name: 'members_lastActivity' }],
    [{ status: 1 }, { name: 'status' }],
  ],
  invitations: [
    [{ tokenHash: 1 }, { name: 'tokenHash_unique', unique: true }],
    [{ projectId: 1 }, { name: 'projectId' }],
    // Limpieza 30 días después de caducar.
    [{ expiresAt: 1 }, { name: 'expiresAt_ttl', expireAfterSeconds: 30 * DAY }],
  ],
  refresh_tokens: [
    [{ tokenHash: 1 }, { name: 'tokenHash_unique', unique: true }],
    // Revocar una familia de sesión completa (reutilización de un token rotado).
    [{ sid: 1 }, { name: 'sid' }],
    [{ expiresAt: 1 }, { name: 'expiresAt_ttl', expireAfterSeconds: 0 }],
  ],
  audit_logs: [[{ projectId: 1, at: -1 }, { name: 'projectId_at' }]],
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

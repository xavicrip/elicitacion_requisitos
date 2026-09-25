// Plantilla que usa `pnpm migrate:create <nombre>` (migrate-mongo la toma de este directorio).
// Reglas (specs/001-plataforma-base/data-model.md §1):
// - `down` DEBE devolver el esquema al estado anterior conservando los datos previos al `up`.
// - `destructive: true` si `up` elimina o transforma datos que `down` no puede reconstruir;
//   en ese caso el despliegue toma un respaldo antes de aplicarla.

export const destructive = false;

/** @param {import('mongodb').Db} _db */
export async function up(_db) {
  // TODO: implementar el cambio de esquema.
}

/** @param {import('mongodb').Db} _db */
export async function down(_db) {
  // TODO: revertir exactamente lo que hace `up`.
}

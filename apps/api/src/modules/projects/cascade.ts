import type { Types } from 'mongoose';

/**
 * Manejador de borrado en cascada de un proyecto (research R9). Debe ser **idempotente**: el
 * job lo reintenta si algo falla, así que puede ejecutarse varias veces para el mismo proyecto.
 */
export type CascadeHandler = (projectId: Types.ObjectId) => Promise<void>;

/**
 * Registro de manejadores: cada feature registra el suyo (diagramas y archivos en la 003,
 * requisitos en la 004…) sin modificar el módulo de proyectos. Se ejecutan en orden.
 */
export function createCascadeRegistry() {
  const handlers: Array<{ name: string; run: CascadeHandler }> = [];
  return {
    register(name: string, run: CascadeHandler): void {
      if (handlers.some((handler) => handler.name === name)) {
        throw new Error(`Manejador de cascada duplicado: ${name}`);
      }
      handlers.push({ name, run });
    },
    async run(projectId: Types.ObjectId): Promise<void> {
      for (const handler of handlers) await handler.run(projectId);
    },
  };
}

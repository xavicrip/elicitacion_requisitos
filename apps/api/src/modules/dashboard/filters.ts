import type { DashboardFilters } from '@reqcanvas/shared';
import { Types } from 'mongoose';

/** Diferencia entre la hora local de `timeZone` y UTC en un instante, en ms. */
export function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const local = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return local - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Primer instante del día `AAAA-MM-DD` en la zona horaria del proyecto. */
export function zonedDayStart(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00.000Z`);
  const first = new Date(guess.getTime() - offsetMs(guess, timeZone));
  // Segunda pasada por si el cambio de horario cae entre la estimación y el resultado.
  return new Date(guess.getTime() - offsetMs(first, timeZone));
}

/** Día siguiente (`AAAA-MM-DD`). */
export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Consulta de `details` para los filtros del dashboard (FR-003). Los duplicados confirmados
 * nunca se cuentan: su original ya los representa (edge case de la spec).
 */
export function detailsQuery(
  projectId: Types.ObjectId,
  filters: DashboardFilters,
  timeZone: string,
): Record<string, unknown> {
  const statuses = filters.statuses.filter((status) => status !== 'duplicate');
  const query: Record<string, unknown> = { projectId, status: { $in: statuses } };
  if (filters.types) query.type = { $in: filters.types };
  if (filters.diagramIds) {
    query.diagramId = {
      $in: filters.diagramIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id)),
    };
  }
  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = zonedDayStart(filters.from, timeZone);
    if (filters.to) range.$lt = zonedDayStart(nextDay(filters.to), timeZone);
    query.createdAt = range;
  }
  return query;
}

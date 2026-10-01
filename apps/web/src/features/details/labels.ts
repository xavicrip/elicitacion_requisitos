import type { DetailStatus, DetailType, Priority } from '@reqcanvas/shared';

export const DETAIL_TYPE_LABEL: Record<DetailType, string> = {
  functional: 'Funcional',
  non_functional: 'No funcional',
  business_rule: 'Regla de negocio',
  constraint: 'Restricción',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  must: 'Must (imprescindible)',
  should: 'Should (importante)',
  could: 'Could (deseable)',
  wont: "Won't (no ahora)",
};

export const DETAIL_STATUS_LABEL: Record<DetailStatus, string> = {
  pending: 'Pendiente',
  validated: 'Validado',
  duplicate: 'Duplicado',
  discarded: 'Descartado',
};

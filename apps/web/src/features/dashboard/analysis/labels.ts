import type { AnalysisProgress, DashboardFilters } from '@reqcanvas/shared';
import { DETAIL_STATUS_LABEL, DETAIL_TYPE_LABEL } from '../../details/labels';

/** Etapas del análisis, en texto para el progreso. */
export const STAGE_LABEL: Record<AnalysisProgress['stage'], string> = {
  download: 'leyendo los detalles',
  keywords: 'palabras clave',
  cooccurrence: 'términos que aparecen juntos',
  topics: 'temas',
  clusters: 'grupos de requisitos similares',
  duplicates: 'posibles duplicados',
  sentiment: 'sentimiento',
  quality: 'calidad de los requisitos',
  association: 'reglas de asociación',
  hotcold: 'actividades críticas',
  insights: 'resumen de hallazgos',
  upload: 'guardando los resultados',
};

const day = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone: 'UTC' });
const formatDay = (date: string) => day.format(new Date(`${date}T00:00:00Z`));

/** Filtros con los que se calculó un análisis, en una frase (plan, ajuste 14). */
export function describeFilters(filters: DashboardFilters): string {
  const parts = [
    `estados: ${filters.statuses.map((status) => DETAIL_STATUS_LABEL[status].toLowerCase()).join(', ')}`,
  ];
  if (filters.types) {
    parts.push(`tipo: ${filters.types.map((type) => DETAIL_TYPE_LABEL[type]).join(', ')}`);
  }
  if (filters.diagramIds) parts.push('un diagrama');
  if (filters.from) parts.push(`desde el ${formatDay(filters.from)}`);
  if (filters.to) parts.push(`hasta el ${formatDay(filters.to)}`);
  return parts.join(' · ');
}

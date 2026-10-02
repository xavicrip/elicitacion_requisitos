import type { ConfidenceLevel, DetectionStage } from '@reqcanvas/shared';

export const STAGE_LABEL: Record<DetectionStage, string> = {
  download: 'Descargando la imagen',
  shapes: 'Buscando formas',
  ocr: 'Leyendo los textos',
  arrows: 'Buscando flechas',
  refine: 'Revisando los nombres',
};

/** Confianza con texto e icono, no solo con color (accesibilidad, research R7). */
export const CONFIDENCE: Record<ConfidenceLevel, { label: string; icon: string; color: string }> = {
  high: { label: 'Confianza alta', icon: '●', color: '#15803D' },
  medium: { label: 'Confianza media', icon: '◐', color: '#B45309' },
  low: { label: 'Confianza baja', icon: '○', color: '#6B7280' },
};

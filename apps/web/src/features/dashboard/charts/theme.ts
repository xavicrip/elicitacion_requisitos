/**
 * Paleta de los gráficos del dashboard (guía dataviz): tonos categóricos en orden fijo, validados
 * para daltonismo sobre la superficie clara; el texto usa tokens de texto, nunca el color de la
 * serie. La app solo tiene tema claro.
 */
export const VIZ = {
  surface: '#fcfcfb',
  text: '#0b0b0b',
  textSecondary: '#52514e',
  grid: '#e4e3df',
  /** Orden fijo: azul, naranja, aguamarina. No se reasignan al filtrar. */
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
  /** Lo que no pertenece a ninguna categoría destacada. */
  neutral: '#b8b7b0',
} as const;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Los tooltips de ECharts interpretan HTML: todo texto que venga de los datos (nombres de
 * actividad, términos, detalles) pasa por aquí (plan de la 007, ajuste 15; constitución V).
 */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

/**
 * Saneamiento de las exportaciones (feature 008, research R2 y R4): fórmulas de hojas de cálculo
 * y nombres de archivo.
 */

/** Inicios que una hoja de cálculo interpreta como fórmula (OWASP, CSV Injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Antepone un apóstrofo a lo que una hoja de cálculo ejecutaría como fórmula. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

const MAX_NAME = 80;

/** `Validar pago: ¿aprobó?` → `validar-pago-aprobo`; nunca vacío, como máximo 80 caracteres. */
export function safeFileName(name: string, fallback = 'sin-nombre'): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME)
    .replace(/-+$/, '');
  return slug || fallback;
}

/** Devuelve nombres únicos: el segundo `validar-pago` pasa a `validar-pago-2`. */
export function uniqueNames(): (name: string) => string {
  const used = new Map<string, number>();
  return (name) => {
    let candidate = name;
    while (used.has(candidate)) {
      const next = (used.get(name) ?? 1) + 1;
      used.set(name, next);
      candidate = `${name.slice(0, MAX_NAME - String(next).length - 1)}-${next}`;
    }
    used.set(candidate, used.get(candidate) ?? 1);
    return candidate;
  };
}

/** `AAAAMMDD-HHmm` en la zona horaria del proyecto. */
export function fileStamp(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}${value('month')}${value('day')}-${value('hour')}${value('minute')}`;
}

const EXTENSION = { csv: 'csv', xlsx: 'xlsx', gherkin: 'zip', pdf: 'pdf' } as const;

/** `reqcanvas-<proyecto>-<AAAAMMDD-HHmm>.<ext>` (Gherkin: `reqcanvas-<proyecto>-gherkin.zip`). */
export function exportFileName(
  project: string,
  format: keyof typeof EXTENSION,
  date: Date,
  timeZone: string,
): string {
  const slug = safeFileName(project, 'proyecto').slice(0, 50).replace(/-+$/, '');
  const suffix = format === 'gherkin' ? 'gherkin' : fileStamp(date, timeZone);
  return `reqcanvas-${slug}-${suffix}.${EXTENSION[format]}`;
}

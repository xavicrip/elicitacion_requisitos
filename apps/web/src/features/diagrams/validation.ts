/** Mismos límites que la API (FR-001); la API vuelve a comprobar el contenido real. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED = /\.(png|jpe?g|svg)$/i;
export const ACCEPT_ATTRIBUTE = '.png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml';

/** Comprobación previa en el navegador: evita subir 10 MB para recibir un error. */
export function checkFile(file: File): string | null {
  if (!ACCEPTED.test(file.name)) return 'Formato no admitido. Sube una imagen PNG, JPG o SVG.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Máximo 10 MB: reduce el tamaño de la imagen.';
  return null;
}

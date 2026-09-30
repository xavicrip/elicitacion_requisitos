import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { HttpError } from './errors.js';

/** Lado mayor de la imagen display: límite habitual de texturas WebGL en GPU integradas. */
export const MAX_DISPLAY_SIDE = 8192;
/** Lado mayor de la miniatura del minimapa. */
export const THUMB_SIDE = 512;
/** Densidad por defecto de librsvg; el SVG se rasteriza al doble. */
const SVG_BASE_DENSITY = 72;
const XML_MIMES = new Set(['application/xml', 'text/xml', 'image/svg+xml']);

export type ProcessedImage = {
  /** Lo que se guarda como original; un SVG se guarda ya rasterizado (nunca se sirve el SVG). */
  original: { buffer: Buffer; mime: 'image/png' | 'image/jpeg'; ext: 'png' | 'jpg' };
  display: { buffer: Buffer; width: number; height: number };
  thumb: { buffer: Buffer; width: number; height: number };
  durationMs: number;
};

const unsupported = () =>
  new HttpError(415, 'UNSUPPORTED_FORMAT', 'Formato no admitido. Sube una imagen PNG, JPG o SVG.');

/** XML con raíz `<svg>` (tras la declaración XML, comentarios y DOCTYPE opcionales). */
function isSvg(input: Buffer): boolean {
  const head = input
    .subarray(0, 4096)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[\s\S]*?\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .trimStart();
  return /^<svg[\s>]/i.test(head);
}

/** Rasteriza el SVG a PNG al doble de su tamaño intrínseco, sin superar `MAX_DISPLAY_SIDE`. */
async function rasterizeSvg(input: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(input).metadata();
  const scale = Math.min(2, MAX_DISPLAY_SIDE / Math.max(width, height, 1));
  return sharp(input, { density: SVG_BASE_DENSITY * scale })
    .png()
    .toBuffer();
}

async function toOriginal(input: Buffer): Promise<ProcessedImage['original']> {
  const type = await fileTypeFromBuffer(input);
  if (type?.mime === 'image/png') return { buffer: input, mime: 'image/png', ext: 'png' };
  if (type?.mime === 'image/jpeg') return { buffer: input, mime: 'image/jpeg', ext: 'jpg' };
  // `file-type` no detecta SVG: o no reconoce el texto o lo ve como XML genérico.
  if ((!type || XML_MIMES.has(type.mime)) && isSvg(input)) {
    return { buffer: await rasterizeSvg(input), mime: 'image/png', ext: 'png' };
  }
  throw unsupported();
}

/**
 * Valida la imagen por su contenido real (no por la extensión) y genera la versión display
 * (WebP, lado mayor ≤ 8192 px, orientación aplicada y sin metadatos) y la miniatura
 * (research R2). Un archivo que no es PNG, JPEG ni SVG, o que no se puede decodificar, → 415.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const started = performance.now();
  try {
    const original = await toOriginal(input);
    const display = await sharp(original.buffer, { failOn: 'error' })
      .rotate()
      .resize({
        width: MAX_DISPLAY_SIDE,
        height: MAX_DISPLAY_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(display.data)
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return {
      original,
      display: { buffer: display.data, width: display.info.width, height: display.info.height },
      thumb: { buffer: thumb.data, width: thumb.info.width, height: thumb.info.height },
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // sharp no pudo decodificar el archivo (corrupto o truncado).
    throw unsupported();
  }
}

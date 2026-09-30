import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/lib/errors';
import { processImage } from '../../src/lib/image-pipeline';

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../e2e/fixtures/diagrams/${name}`, import.meta.url)),
  );

async function expectUnsupported(input: Buffer) {
  const error = await processImage(input).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ statusCode: 415, code: 'UNSUPPORTED_FORMAT' });
}

describe('processImage (research R2)', () => {
  it('PNG: conserva el original y genera display WebP y thumb de 512 px', async () => {
    const input = fixture('compra-simple.png');
    const result = await processImage(input);
    expect(result.original).toMatchObject({ mime: 'image/png', ext: 'png' });
    expect(result.original.buffer.equals(input)).toBe(true);

    expect(result.display).toMatchObject({ width: 900, height: 1200 });
    expect((await sharp(result.display.buffer).metadata()).format).toBe('webp');
    const thumb = await sharp(result.thumb.buffer).metadata();
    expect(thumb).toMatchObject({ format: 'webp', width: 384, height: 512 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('detecta el tipo por magic bytes, no por la extensión: un JPEG vale aunque se llame .png', async () => {
    const jpeg = await sharp(fixture('compra-simple.png')).jpeg().toBuffer();
    expect((await processImage(jpeg)).original).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('JPEG con EXIF: aplica la orientación y no conserva metadatos en display', async () => {
    const jpeg = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#88aaff' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await processImage(jpeg);
    expect(result.display).toMatchObject({ width: 100, height: 200 });
    const meta = await sharp(result.display.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('limita el lado mayor de display a 8192 px y guarda sus dimensiones', async () => {
    const result = await processImage(fixture('enorme-12000.png'));
    expect(result.display).toMatchObject({ width: 8192, height: 1024 });
    expect(await sharp(result.thumb.buffer).metadata()).toMatchObject({ width: 512, height: 64 });
  });

  it('no amplía imágenes pequeñas', async () => {
    const small = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const result = await processImage(small);
    expect(result.display).toMatchObject({ width: 300, height: 200 });
    expect(await sharp(result.thumb.buffer).metadata()).toMatchObject({ width: 300, height: 200 });
  });

  it('SVG: se rasteriza a PNG al doble de su tamaño sin conservar el script ni la referencia externa', async () => {
    const result = await processImage(fixture('con-script.svg'));
    expect(result.original).toMatchObject({ mime: 'image/png', ext: 'png' });
    expect((await sharp(result.original.buffer).metadata()).format).toBe('png');
    for (const buffer of [result.original.buffer, result.display.buffer]) {
      expect(buffer.includes('<script')).toBe(false);
      expect(buffer.includes('example.com')).toBe(false);
    }
    expect(result.display).toMatchObject({ width: 1200, height: 800 });
  });

  it('SVG con declaración XML y comentarios también se reconoce', async () => {
    const svg = Buffer.from(
      '<?xml version="1.0"?>\n<!-- diagrama -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    expect((await processImage(svg)).display).toMatchObject({ width: 20, height: 20 });
  });

  it.each([
    ['PDF', Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF')],
    ['ejecutable renombrado a .png', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(512, 0x90)])],
    ['texto plano', Buffer.from('no soy una imagen')],
    ['XML que no es SVG', Buffer.from('<?xml version="1.0"?><html><body/></html>')],
    [
      'PNG corrupto',
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(64),
      ]),
    ],
  ])('%s → 415 UNSUPPORTED_FORMAT', async (_caso, input) => {
    await expectUnsupported(input);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  featureFiles,
  gherkinZip,
  README_NAME,
  renderFeature,
} from '../../src/modules/exports/gherkin';
import type { ExportRow } from '../../src/modules/exports/query';
import { asRows, collect, exportRow } from '../helpers/export-rows';
import { parseFeature, unzip } from '../helpers/gherkin';

// US2 de la 008 (FR-004, SC-002; research R4; contracts/export-formats.md).

const scenarios = (text: string) =>
  parseFeature(text).feature!.children.map((child) => child.scenario!);

async function files(rows: ExportRow[]) {
  const found = [];
  for await (const file of featureFiles(asRows(rows))) found.push(file);
  return found;
}

describe('renderFeature', () => {
  it('sigue la plantilla: idioma, etiqueta del diagrama, característica y escenario', () => {
    expect(renderFeature([exportRow({ tags: ['pagos'] })])).toBe(
      [
        '# language: es',
        '@diagrama-proceso-de-compra',
        'Característica: Validar pago',
        '  Requisitos levantados para la actividad "Validar pago" del diagrama "Proceso de compra".',
        '',
        '  @must @no-funcional @pagos @validado',
        '  Escenario: el sistema confirma el pago en menos de',
        '    Dado el cliente tiene productos en el carrito',
        '    Cuando paga con tarjeta',
        '    Entonces el sistema confirma el pago en menos de 5 segundos',
        '',
      ].join('\n'),
    );
  });

  it('un escenario por detalle, con sus pasos', () => {
    const text = renderFeature([
      exportRow(),
      exportRow({ shortId: '00000002', given: 'hay stock', when: 'compra', then: 'se reserva' }),
    ]);
    const document = parseFeature(text);
    expect(document.feature).toMatchObject({
      language: 'es',
      name: 'Validar pago',
      tags: [{ name: '@diagrama-proceso-de-compra' }],
    });
    const [, second] = scenarios(text);
    expect(second!.name).toBe('se reserva');
    expect(second!.steps.map((step) => [step.keyword, step.text])).toEqual([
      ['Dado ', 'hay stock'],
      ['Cuando ', 'compra'],
      ['Entonces ', 'se reserva'],
    ]);
  });

  it('etiqueta con prioridad, tipo, etiquetas normalizadas y estado', () => {
    const tagsOf = (overrides: Partial<ExportRow>) =>
      scenarios(renderFeature([exportRow(overrides)]))[0]!.tags.map((tag) => tag.name);
    expect(
      tagsOf({
        priority: null,
        type: 'business_rule',
        tags: ['Medios de Pago', 'ÁREA #1', '@@', 'medios de pago'],
        status: 'pending',
      }),
    ).toEqual(['@regla-de-negocio', '@medios-de-pago', '@area-1', '@pendiente']);
    expect(tagsOf({ priority: 'wont', type: 'constraint', tags: [] })).toEqual([
      '@wont',
      '@restriccion',
      '@validado',
    ]);
    expect(tagsOf({ type: 'functional', tags: [] })).toContain('@funcional');
  });

  it('añade el ID corto al nombre de los escenarios que se repiten', () => {
    const then = 'uno dos tres cuatro cinco seis siete ocho';
    const names = scenarios(
      renderFeature([
        exportRow({ shortId: 'aaaaaaaa', then: `${then} nueve` }),
        exportRow({ shortId: 'bbbbbbbb', then: `${then} diez` }),
        exportRow({ shortId: 'cccccccc', then: 'otro resultado' }),
      ]),
    ).map((scenario) => scenario.name);
    expect(names).toEqual([`${then} #aaaaaaaa`, `${then} #bbbbbbbb`, 'otro resultado']);
  });

  it('une los textos de varias líneas y no se rompe con caracteres especiales', () => {
    const text = renderFeature([
      exportRow({
        diagramName: 'Compra |\n"""',
        activityLabel: '# Validar\n@pago',
        given: '# no es un comentario\n  @ni-una-etiqueta',
        when: '"""\npaga | con tarjeta\n"""',
        then: '@avisa:\r\n\tEscenario: | otro |',
      }),
      exportRow({ given: '   ', when: '\n', then: '' }),
    ]);
    const document = parseFeature(text);
    expect(document.comments).toHaveLength(0);
    expect(document.feature!.name).toBe('# Validar @pago');
    const [first, blank] = scenarios(text);
    expect(first!.name).toBe('@avisa: Escenario: | otro |');
    expect(first!.steps.map((step) => step.text)).toEqual([
      '# no es un comentario @ni-una-etiqueta',
      '""" paga | con tarjeta """',
      '@avisa: Escenario: | otro |',
    ]);
    expect(first!.steps.every((step) => !step.dataTable && !step.docString)).toBe(true);
    expect(blank!.steps.map((step) => step.text)).toEqual(Array(3).fill('(sin texto)'));
  });

  it('nombra «(huérfano)» la actividad que ya no existe', () => {
    expect(parseFeature(renderFeature([exportRow({ activityLabel: null })])).feature!.name).toBe(
      '(huérfano)',
    );
  });
});

describe('featureFiles', () => {
  it('un archivo por actividad, en la carpeta de su diagrama y sin colisiones', async () => {
    const other = { diagramId: '66f100000000000000000002' };
    const found = await files([
      exportRow({ activityKey: 'a1', activityLabel: 'Validar pago' }),
      exportRow({ activityKey: 'a1', activityLabel: 'Validar pago', shortId: '00000002' }),
      exportRow({ activityKey: 'a2', activityLabel: '¿Validar pago?' }),
      exportRow({ activityKey: 'a3', activityLabel: null }),
      exportRow({ ...other, activityKey: 'b1', activityLabel: 'Validar pago' }),
      exportRow({ ...other, diagramName: 'Devoluciones', activityKey: 'b2', activityLabel: '¡!' }),
    ]);
    expect(found.map((file) => file.path)).toEqual([
      'proceso-de-compra/validar-pago.feature',
      'proceso-de-compra/validar-pago-2.feature',
      'proceso-de-compra/huerfano.feature',
      'proceso-de-compra-2/validar-pago.feature',
      'proceso-de-compra-2/sin-nombre.feature',
    ]);
    expect(scenarios(found[0]!.content)).toHaveLength(2);
  });

  it('los 300 detalles del conjunto de validación se analizan sin errores (SC-002)', async () => {
    const validation = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL('../../../analytics/tests/fixtures/details/validation.json', import.meta.url),
        ),
        'utf8',
      ),
    ) as {
      input: {
        activities: Array<{ key: string; label: string }>;
        details: Array<Partial<ExportRow> & { id: string; activityKey: string }>;
      };
    };
    const labels = new Map(validation.input.activities.map(({ key, label }) => [key, label]));
    const rows = validation.input.details
      .map((detail) =>
        exportRow({
          ...detail,
          shortId: detail.id.slice(-8),
          activityLabel: labels.get(detail.activityKey) ?? null,
        }),
      )
      .sort((a, b) => a.activityKey.localeCompare(b.activityKey));
    expect(rows).toHaveLength(300);

    const found = await files(rows);
    let total = 0;
    for (const file of found) {
      const parsed = scenarios(file.content);
      expect(new Set(parsed.map((scenario) => scenario.name)).size).toBe(parsed.length);
      total += parsed.length;
    }
    expect(total).toBe(300);
    expect(new Set(found.map((file) => file.path)).size).toBe(found.length);
  });
});

describe('gherkinZip', () => {
  it('empaqueta los .feature en un ZIP', async () => {
    const zip = await unzip(await collect(gherkinZip(asRows([exportRow()]))));
    expect([...zip.keys()]).toEqual(['proceso-de-compra/validar-pago.feature']);
    expect(zip.get('proceso-de-compra/validar-pago.feature')).toBe(renderFeature([exportRow()]));
  });

  it('sin escenarios, lleva un LEEME.txt que lo indica', async () => {
    const zip = await unzip(await collect(gherkinZip(asRows([]))));
    expect([...zip.keys()]).toEqual([README_NAME]);
    expect(zip.get(README_NAME)).toContain('No hay requisitos que exportar a Gherkin');
  });

  it('propaga el error de las filas', async () => {
    async function* failing(): AsyncGenerator<ExportRow> {
      yield exportRow();
      throw new Error('cursor roto');
    }
    await expect(collect(gherkinZip(failing()))).rejects.toThrow('cursor roto');
  });
});

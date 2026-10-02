import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DETECTION_STAGES,
  DetectionJobInputSchema,
  DetectionJobSchema,
  DetectionJobStatusSchema,
  DetectionProgressSchema,
  DetectionResultSchema,
  ProposalAcceptInputSchema,
  ProposalStatusSchema,
  confidenceLevel,
} from '../src/detection';

// Contrato de la cola `detection` (specs/006-deteccion-asistida/contracts/detection-job.md). Los
// ejemplos son los mismos que valida el lado Python (apps/analytics/tests/contract/examples).

const example = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../apps/analytics/tests/contract/examples/${name}.json`, import.meta.url),
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;

const result = () =>
  example('result') as { activities: Record<string, unknown>[] } & Record<string, unknown>;

describe('ejemplos del contrato', () => {
  it.each(['result', 'result-no-transitions', 'result-empty'])('%s valida', (name) => {
    expect(DetectionResultSchema.safeParse(example(name)).error?.issues ?? []).toEqual([]);
  });

  it('la entrada y el progreso validan', () => {
    expect(DetectionJobInputSchema.safeParse(example('input')).success).toBe(true);
    expect(DetectionProgressSchema.safeParse(example('progress')).success).toBe(true);
  });
});

describe('entrada del job', () => {
  it('exige la versión 1, una URL y las opciones con idiomas', () => {
    const input = example('input');
    expect(DetectionJobInputSchema.safeParse({ ...input, v: 2 }).success).toBe(false);
    expect(
      DetectionJobInputSchema.safeParse({
        ...input,
        image: { url: 'no-es-url', width: 1, height: 1 },
      }).success,
    ).toBe(false);
    expect(
      DetectionJobInputSchema.safeParse({
        ...input,
        options: { llmRefine: false, arrows: true, languages: [] },
      }).success,
    ).toBe(false);
  });
});

describe('progreso', () => {
  it('etapas del contrato y porcentaje entero de 0 a 100', () => {
    expect(DETECTION_STAGES).toEqual(['download', 'shapes', 'ocr', 'arrows', 'refine']);
    expect(DetectionProgressSchema.safeParse({ stage: 'ocr', pct: 101 }).success).toBe(false);
    expect(DetectionProgressSchema.safeParse({ stage: 'ocr', pct: 5.5 }).success).toBe(false);
    expect(DetectionProgressSchema.safeParse({ stage: 'otra', pct: 5 }).success).toBe(false);
  });
});

describe('resultado', () => {
  it('rechaza una zona fuera de la imagen y una confianza fuera de 0–1', () => {
    const bad = result();
    bad.activities[0] = { ...bad.activities[0], bbox: { x: 0.9, y: 0.1, w: 0.2, h: 0.1 } };
    expect(DetectionResultSchema.safeParse(bad).success).toBe(false);
    const confident = result();
    confident.activities[0] = { ...confident.activities[0], confidence: 1.2 };
    expect(DetectionResultSchema.safeParse(confident).success).toBe(false);
  });

  it('exige tempId únicos y transiciones entre zonas existentes, sin bucles', () => {
    const duplicated = result();
    duplicated.activities[1] = { ...duplicated.activities[1], tempId: 'a1' };
    expect(DetectionResultSchema.safeParse(duplicated).success).toBe(false);
    expect(
      DetectionResultSchema.safeParse({
        ...result(),
        transitions: [{ from: 'a1', to: 'a9', confidence: 0.5 }],
      }).success,
    ).toBe(false);
    expect(
      DetectionResultSchema.safeParse({
        ...result(),
        transitions: [{ from: 'a1', to: 'a1', confidence: 0.5 }],
      }).success,
    ).toBe(false);
  });
});

describe('estados y confianza', () => {
  it('estados del job de la constitución VI y de las propuestas', () => {
    expect(DetectionJobStatusSchema.options).toEqual(['pending', 'running', 'done', 'failed']);
    expect(ProposalStatusSchema.options).toEqual([
      'pending',
      'accepted',
      'discarded',
      'superseded',
    ]);
  });

  it('nivel de confianza: alta ≥ 0,8, media ≥ 0,5, baja', () => {
    expect(confidenceLevel(0.8)).toBe('high');
    expect(confidenceLevel(0.79)).toBe('medium');
    expect(confidenceLevel(0.5)).toBe('medium');
    expect(confidenceLevel(0.49)).toBe('low');
  });

  it('job público: progreso, error y métricas', () => {
    expect(
      DetectionJobSchema.safeParse({
        id: 'j1',
        versionId: 'v1',
        status: 'failed',
        progress: { stage: 'download', pct: 0 },
        error: {
          code: 'IMAGE_DOWNLOAD_FAILED',
          message: 'No se pudo leer la imagen del diagrama.',
        },
        metrics: {
          proposed: 0,
          accepted: 0,
          edited: 0,
          discarded: 0,
          durationMs: null,
          llmUsed: false,
        },
        createdAt: '2026-10-02T00:00:00.000Z',
        finishedAt: '2026-10-02T00:00:05.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('aceptar una propuesta', () => {
  it('correcciones opcionales; un nombre vacío no vale', () => {
    expect(ProposalAcceptInputSchema.safeParse({}).success).toBe(true);
    expect(
      ProposalAcceptInputSchema.safeParse({ label: 'Validar pago', type: 'action' }).success,
    ).toBe(true);
    expect(ProposalAcceptInputSchema.safeParse({ label: '  ' }).success).toBe(false);
  });
});

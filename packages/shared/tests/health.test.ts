import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { HealthSchema } from '../src/health';

const contractPath = fileURLToPath(
  new URL('../../../specs/001-plataforma-base/contracts/health.openapi.yaml', import.meta.url),
);

type ContractExample = { example?: unknown };
type Contract = {
  paths: Record<
    string,
    { get: { responses: Record<string, { content?: Record<string, ContractExample> }> } }
  >;
};

const contract = parse(readFileSync(contractPath, 'utf8')) as Contract;

function examplesOf(path: string): Array<[string, unknown]> {
  const responses = contract.paths[path]?.get.responses ?? {};
  return Object.entries(responses).flatMap(([status, response]) => {
    const example = response.content?.['application/json']?.example;
    return example === undefined ? [] : [[`${path} ${status}`, example] as [string, unknown]];
  });
}

describe('HealthSchema', () => {
  const examples = [...examplesOf('/health'), ...examplesOf('/health/deep')];

  it('el contrato tiene ejemplos que validar', () => {
    expect(examples.length).toBeGreaterThanOrEqual(3);
  });

  it.each(examples)('acepta el ejemplo del contrato %s', (_name, example) => {
    expect(HealthSchema.safeParse(example).success).toBe(true);
  });

  it('rechaza un estado desconocido', () => {
    const result = HealthSchema.safeParse({
      status: 'meh',
      service: 'api',
      version: '0.1.0',
      commit: 'abc',
      checks: {},
      timestamp: '2026-09-25T16:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza un check con latencia negativa', () => {
    const result = HealthSchema.safeParse({
      status: 'ok',
      service: 'api',
      version: '0.1.0',
      commit: 'abc',
      checks: { mongo: { status: 'up', latencyMs: -1 } },
      timestamp: '2026-09-25T16:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

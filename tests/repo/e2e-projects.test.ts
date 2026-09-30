import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

// Los E2E se separan en `smoke` (solo lectura, tras cada despliegue) y `flows` (crean cuentas y
// proyectos; solo contra el stack local o el del CI). Plan de la 002, ajuste 4.

type Config = { projects: Array<{ name: string; testMatch?: unknown }> };

async function loadConfig(baseUrl: string | undefined): Promise<Config> {
  vi.resetModules();
  if (baseUrl === undefined) vi.stubEnv('BASE_URL', '');
  else vi.stubEnv('BASE_URL', baseUrl);
  return (await import('../../e2e/playwright.config')).default as Config;
}

afterEach(() => vi.unstubAllEnvs());

describe('proyectos de Playwright', () => {
  it('en local define smoke y flows', async () => {
    const names = (await loadConfig(undefined)).projects.map((p) => p.name);
    expect(names.sort()).toEqual(['flows', 'smoke']);
  });

  it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'con BASE_URL=%s también define flows',
    async (url) => {
      expect((await loadConfig(url)).projects.map((p) => p.name)).toContain('flows');
    },
  );

  it.each([
    'https://web-staging-0562.up.railway.app',
    'https://web-production-aaa68.up.railway.app',
  ])('contra un entorno desplegado (%s) solo existe smoke', async (url) => {
    expect((await loadConfig(url)).projects.map((p) => p.name)).toEqual(['smoke']);
  });
});

type Step = { name?: string; run?: string };
const steps = (file: string, job: string): Step[] =>
  (parse(readFileSync(file, 'utf8')) as { jobs: Record<string, { steps: Step[] }> }).jobs[job]!
    .steps;

describe('workflows', () => {
  it('deploy.yml ejecuta solo el proyecto smoke contra el entorno', () => {
    const smoke = steps('.github/workflows/deploy.yml', 'deploy').find((s) =>
      s.name?.startsWith('Smoke tests'),
    );
    expect(smoke?.run).toMatch(/pnpm e2e --project smoke\b/);
  });

  it('el job e2e-smoke del CI ejecuta smoke y flows contra el stack local', () => {
    const runs = steps('.github/workflows/ci.yml', 'e2e-smoke').map((s) => s.run ?? '');
    const e2e = runs.find((run) => run.startsWith('pnpm e2e'));
    expect(e2e).toBe('pnpm e2e');
  });
});

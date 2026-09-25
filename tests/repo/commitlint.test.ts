import lint from '@commitlint/lint';
import type { LintOptions } from '@commitlint/types';
import load from '@commitlint/load';
import { beforeAll, describe, expect, it } from 'vitest';

type Loaded = Awaited<ReturnType<typeof load>>;
let config: Loaded;

beforeAll(async () => {
  config = await load({}, { cwd: process.cwd() });
});

async function isValid(message: string): Promise<boolean> {
  const parserOpts = config.parserPreset?.parserOpts as LintOptions['parserOpts'];
  const result = await lint(message, config.rules, parserOpts ? { parserOpts } : {});
  return result.valid;
}

describe('commitlint (Conventional Commits, SC-005)', () => {
  it.each([
    'feat(api): add health',
    'fix(web): corregir la versión en el pie',
    'test(shared): cover flag resolution',
    'ci: add deploy workflow',
    'docs(specs): mark 001 tasks as done',
  ])('acepta "%s"', async (message) => {
    expect(await isValid(message)).toBe(true);
  });

  it.each([
    'cambios varios',
    'feat: ',
    'feature(api): add health',
    'feat(backend): alcance que no existe',
  ])('rechaza "%s"', async (message) => {
    expect(await isValid(message)).toBe(false);
  });

  it('ignora los merge commits (defaultIgnores): en main se evitan con "Rebase and merge" (T047)', async () => {
    expect(await isValid('Merge pull request #1 from xavicrip/003-diagramas-canvas')).toBe(true);
  });
});

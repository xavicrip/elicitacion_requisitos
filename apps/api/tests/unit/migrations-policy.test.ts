import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const files = readdirSync(dir).filter((file) => /^\d{14}-[\w-]+\.js$/.test(file));

describe('política de migraciones (data-model.md §1)', () => {
  it('existe al menos una migración', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s exporta up, down y destructive', async (file) => {
    const migration = await import(pathToFileURL(`${dir}${file}`).href);
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
    expect(typeof migration.destructive).toBe('boolean');
  });
});

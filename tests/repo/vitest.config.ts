import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/repo/**/*.test.ts'], root: '.' },
});

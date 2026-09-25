import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Puntos de entrada del proceso: se verifican con Docker Compose y los smoke tests.
      exclude: ['src/server.ts', 'src/db/cli.ts', 'src/types/**'],
      reporter: ['text-summary', 'lcov'],
      // Principio III de la constitución: cobertura mínima del 70 %.
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 70 },
    },
  },
});

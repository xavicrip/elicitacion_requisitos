import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', migrate: 'src/db/cli.ts' },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // El paquete compartido se publica como TypeScript fuente: se incluye en el bundle.
  noExternal: ['@reqcanvas/shared'],
});

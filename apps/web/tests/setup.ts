import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Con la máquina cargada (CI, suites en paralelo), 1 s no basta para las esperas `findBy*`.
configure({ asyncUtilTimeout: 3000 });

// Sin `globals: true`, Testing Library no limpia el DOM automáticamente entre pruebas.
afterEach(() => {
  cleanup();
});

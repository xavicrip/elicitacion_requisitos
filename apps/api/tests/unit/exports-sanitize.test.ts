import { describe, expect, it } from 'vitest';
import {
  exportFileName,
  fileStamp,
  neutralizeFormula,
  safeFileName,
  uniqueNames,
} from '../../src/modules/exports/sanitize';

// Feature 008, research R2 (inyección de fórmulas) y R4 (nombres de archivo).

describe('neutralizeFormula', () => {
  it.each([
    ['=HYPERLINK("http://x","clic")', '\'=HYPERLINK("http://x","clic")'],
    ['+593 99 123', "'+593 99 123"],
    ['-5 grados', "'-5 grados"],
    ['@usuario', "'@usuario"],
    ['\tcon tabulador', "'\tcon tabulador"],
    ['\rcon retorno', "'\rcon retorno"],
  ])('antepone un apóstrofo a %j', (value, expected) => {
    expect(neutralizeFormula(value)).toBe(expected);
  });

  it.each(['el cliente paga', 'a = b + c', '5 - 3', 'correo@ejemplo.com', '', ' =1+1'])(
    'deja intacto %j',
    (value) => {
      expect(neutralizeFormula(value)).toBe(value);
    },
  );
});

describe('safeFileName', () => {
  it('quita tildes, pasa a minúsculas y deja solo [a-z0-9-]', () => {
    expect(safeFileName('Validar pago: ¿aprobó?')).toBe('validar-pago-aprobo');
    expect(safeFileName('Emisión/Facturación  Ñandú')).toBe('emision-facturacion-nandu');
    expect(safeFileName('../../etc/passwd')).toBe('etc-passwd');
  });

  it('nunca devuelve vacío y corta a 80 caracteres sin guion final', () => {
    expect(safeFileName('¿¡!?')).toBe('sin-nombre');
    expect(safeFileName('', 'actividad')).toBe('actividad');
    const long = safeFileName(`${'a'.repeat(79)} b c`);
    expect(long).toHaveLength(79);
    expect(long.endsWith('-')).toBe(false);
  });
});

describe('uniqueNames', () => {
  it('resuelve las colisiones con un sufijo numérico', () => {
    const unique = uniqueNames();
    expect(['pago', 'pago', 'envio', 'pago', 'pago-2'].map(unique)).toEqual([
      'pago',
      'pago-2',
      'envio',
      'pago-3',
      'pago-2-2',
    ]);
  });

  it('el sufijo cabe en los 80 caracteres', () => {
    const unique = uniqueNames();
    const name = 'a'.repeat(80);
    unique(name);
    expect(unique(name)).toHaveLength(80);
  });
});

describe('nombre del archivo', () => {
  const date = new Date('2026-10-04T02:30:00.000Z');

  it('la marca de tiempo usa la zona horaria del proyecto', () => {
    expect(fileStamp(date, 'America/Guayaquil')).toBe('20261003-2130');
    expect(fileStamp(date, 'UTC')).toBe('20261004-0230');
  });

  it('reqcanvas-<proyecto>-<fecha>.<ext>; Gherkin es un ZIP sin fecha', () => {
    expect(exportFileName('Tienda demo', 'csv', date, 'America/Guayaquil')).toBe(
      'reqcanvas-tienda-demo-20261003-2130.csv',
    );
    expect(exportFileName('Tienda demo', 'xlsx', date, 'UTC')).toBe(
      'reqcanvas-tienda-demo-20261004-0230.xlsx',
    );
    expect(exportFileName('Tienda demo', 'pdf', date, 'UTC')).toMatch(/\.pdf$/);
    expect(exportFileName('Tienda demo', 'gherkin', date, 'UTC')).toBe(
      'reqcanvas-tienda-demo-gherkin.zip',
    );
    expect(exportFileName('¿?', 'csv', date, 'UTC')).toBe('reqcanvas-proyecto-20261004-0230.csv');
  });
});

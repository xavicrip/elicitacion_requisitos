import { describe, expect, it, vi } from 'vitest';
import { defineFlags, resolveFlags } from '../src/flags';

const registry = defineFlags({
  detection: { description: 'Detección asistida', default: false, owner: '006-deteccion-asistida' },
  realtime: {
    description: 'Colaboración en tiempo real',
    default: true,
    owner: '005-colaboracion-tiempo-real',
  },
});

describe('resolveFlags', () => {
  it('usa los valores por defecto si el entorno no define nada', () => {
    expect(resolveFlags(undefined, registry)).toEqual({ detection: false, realtime: true });
    expect(resolveFlags('', registry)).toEqual({ detection: false, realtime: true });
  });

  it('sobrescribe con FEATURE_FLAGS (nombre=true|false, separados por comas)', () => {
    expect(resolveFlags('detection=true, realtime=false', registry)).toEqual({
      detection: true,
      realtime: false,
    });
  });

  it('avisa (sin fallar) ante un nombre desconocido', () => {
    const warn = vi.fn();
    expect(resolveFlags('insights=true,detection=true', registry, warn)).toEqual({
      detection: true,
      realtime: true,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('insights'));
  });

  it('avisa ante un valor que no es true/false y conserva el valor por defecto', () => {
    const warn = vi.fn();
    expect(resolveFlags('detection=si', registry, warn)).toEqual({
      detection: false,
      realtime: true,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('detection'));
  });
});

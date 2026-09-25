/** Definición de un feature flag (data-model.md §2). */
export type FlagDefinition = {
  description: string;
  default: boolean;
  /** Feature que introduce el flag, p. ej. `006-deteccion-asistida`. */
  owner: string;
};

export type FlagRegistry = Record<string, FlagDefinition>;
export type ResolvedFlags<R extends FlagRegistry> = { [K in keyof R]: boolean };

export function defineFlags<const R extends FlagRegistry>(registry: R): R {
  return registry;
}

/**
 * Registro de flags del proyecto. Cada feature añade aquí los suyos (nombre en kebab-case).
 * Ver docs/feature-flags.md.
 */
export const FLAGS = defineFlags({});

/**
 * Resuelve los flags a partir de `FEATURE_FLAGS` (`nombre=true|false`, separados por comas).
 * Los nombres desconocidos o valores inválidos generan un aviso y no un error.
 */
export function resolveFlags<R extends FlagRegistry>(
  raw: string | undefined,
  registry: R,
  warn: (message: string) => void = () => {},
): ResolvedFlags<R> {
  const resolved = Object.fromEntries(
    Object.entries(registry).map(([name, def]) => [name, def.default]),
  ) as Record<string, boolean>;

  for (const entry of (raw ?? '').split(',')) {
    const pair = entry.trim();
    if (!pair) continue;
    const [name = '', value = ''] = pair.split('=').map((part) => part.trim());
    if (!Object.hasOwn(registry, name)) {
      warn(`FEATURE_FLAGS: flag desconocido "${name}" (se ignora)`);
      continue;
    }
    if (value !== 'true' && value !== 'false') {
      warn(`FEATURE_FLAGS: valor inválido para "${name}" (se usa el valor por defecto)`);
      continue;
    }
    resolved[name] = value === 'true';
  }
  return resolved as ResolvedFlags<R>;
}

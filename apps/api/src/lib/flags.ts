import { FLAGS, resolveFlags, type ResolvedFlags } from '@reqcanvas/shared';

export type ActiveFlags = ResolvedFlags<typeof FLAGS>;

/** Resuelve los flags activos del entorno (`FEATURE_FLAGS`) con el registro compartido. */
export function loadFlags(
  raw: string | undefined,
  warn: (message: string) => void = () => {},
): ActiveFlags {
  return resolveFlags(raw, FLAGS, warn);
}

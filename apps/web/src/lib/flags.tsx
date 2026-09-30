import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type Flags = Record<string, boolean>;

/**
 * Flags activos del entorno, de `GET /api/config` (docs/feature-flags.md). Si no se pueden
 * leer, todos cuentan como desactivados: una funcionalidad oculta nunca se muestra por error.
 */
export function useFlags(): { flags: Flags; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['flags'],
    queryFn: async (): Promise<Flags> => {
      const response = await fetch('/api/config', { credentials: 'same-origin' });
      if (!response.ok) return {};
      return ((await response.json()) as { flags?: Flags }).flags ?? {};
    },
    staleTime: Infinity,
  });
  return { flags: data ?? {}, isLoading };
}

/** Muestra `children` solo si `flag` está activado; si no, `fallback`. */
export function FlagGate({
  flag,
  children,
  fallback = null,
}: {
  flag: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { flags, isLoading } = useFlags();
  if (isLoading) return null;
  return <>{flags[flag] ? children : fallback}</>;
}

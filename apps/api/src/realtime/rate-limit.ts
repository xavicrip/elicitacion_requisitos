/**
 * Límite por socket y evento en memoria (plan de la 005, ajuste 10): cada socket vive en una
 * réplica, así que no hace falta Redis. Ventana deslizante de 1 s.
 */
export function createRateLimiter(perSecond: number, now: () => number = Date.now) {
  const times: number[] = [];
  return function allow(): boolean {
    const current = now();
    while (times.length > 0 && current - times[0]! >= 1000) times.shift();
    if (times.length >= perSecond) return false;
    times.push(current);
    return true;
  };
}

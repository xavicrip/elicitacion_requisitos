export class TimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutError';
  }
}

/** Rechaza con `TimeoutError` si `promise` no termina en `ms` milisegundos. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

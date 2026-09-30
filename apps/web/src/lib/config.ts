/** Configuración de ejecución que el contenedor escribe en `/config.js` al arrancar. */
export type RuntimeConfig = {
  apiUrl: string;
  version: string;
  /** Ganchos de los E2E (`window.__canvasState`); solo con `E2E_HOOKS=true`. */
  e2eHooks: boolean;
};

declare global {
  interface Window {
    __REQCANVAS_CONFIG__?: Partial<RuntimeConfig>;
  }
}

export function getConfig(): RuntimeConfig {
  const injected = typeof window === 'undefined' ? undefined : window.__REQCANVAS_CONFIG__;
  return {
    apiUrl: injected?.apiUrl ?? '/api',
    version: injected?.version ?? 'dev',
    e2eHooks: injected?.e2eHooks === true,
  };
}

/** WebGL 2 es necesario para el canvas three.js. */
export function supportsWebGL2(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

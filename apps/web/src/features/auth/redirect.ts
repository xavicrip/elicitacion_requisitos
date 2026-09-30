/**
 * Destino tras entrar o registrarse (`?redirect=`). Solo rutas internas: evita redirigir a
 * otro sitio con `?redirect=https://…` o `//otro.sitio`.
 */
export function safeRedirect(target: string | null): string {
  return target && target.startsWith('/') && !target.startsWith('//') ? target : '/proyectos';
}

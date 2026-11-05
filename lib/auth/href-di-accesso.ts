/**
 * S10 (5/11/2026) — Il link «Accedi» che riporta dove si era.
 *
 * Senza `returnTo` la pagina di accesso porta in home. Dalle pagine
 * d'accesso stesse (e dalla home) il ritorno non serve.
 */
export function hrefDiAccesso(pathname: string | null | undefined, query: string = ''): string {
  if (!pathname || pathname === '/') return '/sign-in';
  if (/^\/(sign-in|sign-up|reset-password|auth|accetta-condizioni)(\/|$)/.test(pathname)) return '/sign-in';
  const q = query && query !== '?' ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `/sign-in?returnTo=${encodeURIComponent(pathname + q)}`;
}

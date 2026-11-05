/**
 * 5/11/2026 — In ilike «_» e «%» valgono «una lettera qualsiasi» e «qualsiasi cosa»: /u/a_b
 * trovava anche «axb», e con due righe maybeSingle andava in errore. Si proteggono, così il
 * confronto resta senza maiuscole ma esatto.
 */
export function handleEsatto(handle: string): string {
  // Chi passa da qui ha già un handle valido (handleValido): restano da proteggere i jolly.
  return handle.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Un handle si scrive solo con lettere, cifre e «_» (components/PublicProfileToggle.tsx). Tutto il
 * resto — «*» compreso, che per PostgREST dentro ilike vale come «%» — non è un handle: non si chiede
 * nemmeno al database.
 */
export function handleValido(handle: string): boolean {
  return /^[a-z0-9_]{1,30}$/i.test(handle);
}

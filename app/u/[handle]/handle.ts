/**
 * 5/11/2026 — In ilike «_» e «%» valgono «una lettera qualsiasi» e «qualsiasi cosa»: /u/a_b
 * trovava anche «axb», e con due righe maybeSingle andava in errore. Si proteggono, così il
 * confronto resta senza maiuscole ma esatto.
 */
export function handleEsatto(handle: string): string {
  return handle.replace(/[\\%_]/g, (c) => `\\${c}`);
}

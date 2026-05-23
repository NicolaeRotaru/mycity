/**
 * Restituisce un path interno sicuro per redirect post-login/post-azione.
 * Blocca:
 *  - URL assoluti http(s)://
 *  - URL protocol-relative //
 *  - URL con backslash (alcuni browser le normalizzano in /)
 *  - URL non stringa
 * Fallback al path di default.
 */
export function safeInternalPath(input: unknown, fallback = '/'): string {
  if (typeof input !== 'string') return fallback;
  const s = input.trim();
  if (s.length === 0) return fallback;
  if (s.length > 512) return fallback;

  // Deve iniziare con singolo slash
  if (!s.startsWith('/')) return fallback;
  // Blocca protocol-relative // e backslash
  if (s.startsWith('//') || s.startsWith('/\\')) return fallback;
  // Blocca schemi noti
  if (/^\/?(javascript|data|vbscript|file):/i.test(s)) return fallback;
  // Solo path + opzionale query/hash, niente caratteri esotici a inizio
  return s;
}

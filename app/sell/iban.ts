/**
 * L'IBAN del negozio, letto come lo scrive una persona: con gli spazi a gruppi
 * di quattro e magari in minuscolo. Prima si toglie quello che non conta, poi
 * si controlla la cifra di controllo (mod 97, ISO 13616): un errore di
 * battitura non arriva fino al primo bonifico.
 *
 * La usano il modulo (components/SellerApplicationForm.tsx) e la rotta
 * (app/api/seller/apply/route.ts), così dicono la stessa cosa.
 */
export function normalizzaIban(v: string): string {
  return v.replace(/[\s.-]+/g, '').toUpperCase();
}

export function ibanValido(v: string): boolean {
  const iban = normalizzaIban(v);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('IT') && iban.length !== 27) return false;
  const riordinato = iban.slice(4) + iban.slice(0, 4);
  let resto = 0;
  for (const ch of riordinato) {
    const n = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) resto = (resto * 10 + Number(d)) % 97;
  }
  return resto === 1;
}

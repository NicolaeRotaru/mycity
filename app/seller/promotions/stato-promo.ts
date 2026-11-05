/**
 * Lo stato di una promozione come lo legge il negoziante: lo storico scriveva
 * quello grezzo del database («cancelled», e «active» accanto a «Terminata»).
 */
export function statoDellaPromo(p: { status: string | null; ends_at: string | null }, adesso: Date = new Date()): string {
  if (p.status === 'cancelled') return 'Annullata';
  if (p.ends_at && new Date(p.ends_at).getTime() <= adesso.getTime()) return 'Scaduta';
  if (p.status === 'active') return 'Attiva';
  return p.status ?? '';
}

/**
 * Le SPESE di un cliente, non le righe di `orders`.
 *
 * Un carrello con prodotti di due negozi crea due ordini (uno per negozio): con
 * la carta dalla stessa sessione Stripe, coi contanti nello stesso giro della
 * cassa, a pochi istanti l'uno dall'altro. Il funnel contava le righe: chi
 * aveva pagato una volta sola da due negozi finiva fra i clienti che tornano, e
 * non poteva mai risultare «a rischio».
 *
 * Qui gli ordini della stessa spesa si uniscono: stessa sessione Stripe, oppure
 * (contanti, nessuna sessione) creati entro `FINESTRA_STESSA_SPESA_MS` dal
 * precedente. Torna la data d'inizio di ogni spesa, in ordine.
 * 🟢 Puro: nessuna rete, nessun orologio.
 */
export const FINESTRA_STESSA_SPESA_MS = 2 * 60_000;

export type OrdineDelCliente = { created_at: string; stripe_session_id?: string | null };

export function speseDistinte(ordini: readonly OrdineDelCliente[]): Date[] {
  const ordinati = [...ordini]
    .map((o) => ({ t: new Date(o.created_at).getTime(), sessione: o.stripe_session_id ?? null }))
    .filter((o) => Number.isFinite(o.t))
    .sort((a, b) => a.t - b.t);
  const spese: Array<{ inizio: number; ultimo: number; sessione: string | null }> = [];
  for (const o of ordinati) {
    const stessaSessione = o.sessione ? spese.find((s) => s.sessione === o.sessione) : undefined;
    if (stessaSessione) { stessaSessione.ultimo = o.t; continue; }
    const ultima = spese[spese.length - 1];
    if (!o.sessione && ultima && !ultima.sessione && o.t - ultima.ultimo <= FINESTRA_STESSA_SPESA_MS) {
      ultima.ultimo = o.t;
      continue;
    }
    spese.push({ inizio: o.t, ultimo: o.t, sessione: o.sessione });
  }
  return spese.map((s) => new Date(s.inizio));
}

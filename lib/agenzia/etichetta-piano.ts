import { FASCE, type AbbonamentoAttivo } from '@/lib/agenzia/preventivo';

/**
 * IL PIANO SOTTO IL NOME — 24/11/2026.
 *
 * Nicola: «vedi l'abbonamento a sinistra? usa la tecnica di Claude: lo metti nelle impostazioni,
 * però è sempre visibile in qualche modo e ricorda con quale abbonamento sei». Come su Claude, in
 * fondo al menu c'è il negozio col suo piano sotto il nome («Piano Business»); la pagina
 * dell'abbonamento si apre da lì e dal Profilo, non è più una voce del menu Servizi.
 *
 * Questa è la regola di cosa si scrive sotto il nome, in un posto solo, così il menu e il Profilo
 * dicono la stessa cosa:
 *  · abbonamento pagato        → «Piano Business»;
 *  · abbonamento incluso       → «Piano Premium · incluso» (SDG, 28/11/2026: non paga);
 *  · pagamento non riuscito    → «Piano Business», con l'avviso «pagamento da sistemare»;
 *  · nessun abbonamento        → «Nessun abbonamento», e la voce invita a sceglierlo;
 *  · lettura in corso o caduta → «Venditore», come prima: non si dice «nessun abbonamento» a chi
 *    magari ce l'ha, solo perché la lettura non è arrivata.
 */
export type TonoPiano = 'attivo' | 'da_sistemare' | 'nessuno' | 'sconosciuto';

export type EtichettaPiano = {
  /** La riga sotto il nome del negozio. */
  testo: string;
  /** Un avviso corto accanto, solo quando c'è qualcosa da fare. */
  avviso: string | null;
  tono: TonoPiano;
  /** Il testo della voce che porta alla pagina dell'abbonamento. */
  voce: string;
};

export function etichettaPiano(
  attivo: AbbonamentoAttivo | null | undefined,
  letto: boolean,
): EtichettaPiano {
  if (!letto) {
    return { testo: 'Venditore', avviso: null, tono: 'sconosciuto', voce: 'Abbonamento' };
  }
  if (!attivo) {
    return { testo: 'Nessun abbonamento', avviso: null, tono: 'nessuno', voce: 'Scegli il tuo abbonamento' };
  }
  const piano = `Piano ${FASCE[attivo.fascia].nome}`;
  // 28/11/2026 — SDG ha il Premium per regola e non lo paga (lib/agenzia/abbonamento-di-sdg.ts).
  if (attivo.incluso) return { testo: `${piano} · incluso`, avviso: null, tono: 'attivo', voce: 'Il tuo abbonamento' };
  if (attivo.stato === 'past_due') {
    return { testo: piano, avviso: 'Pagamento da sistemare', tono: 'da_sistemare', voce: 'Il tuo abbonamento' };
  }
  return { testo: piano, avviso: null, tono: 'attivo', voce: 'Il tuo abbonamento' };
}

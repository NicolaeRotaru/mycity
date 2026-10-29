import type { SupabaseClient } from '@supabase/supabase-js';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import { formatPrice } from '@/lib/format';
import { ETICHETTA_ADESSO, expressSiPuo } from '@/lib/quando-arriva';
import { negozioPuoServire } from '@/lib/store-hours';

/**
 * 29/10/2026 — LA CONSEGNA VELOCE SI VENDE SOLO SE SI PUÒ MANTENERE.
 *
 * La fascia «Adesso» prometteva 30-60 minuti guardando solo l'orologio del browser
 * (`expressSiPuo`): nessuno controllava che il negozio fosse aperto né che ci fosse un fattorino
 * approvato e acceso. In produzione il 29/10 c'era un solo fattorino, in attesa di approvazione:
 * ogni «Adesso» venduto era una promessa che nessuno poteva mantenere.
 *
 * Qui c'è UNA decisione, `veloceSiPuo`, con tre condizioni: dalle 8 alle 21 (ora di Piacenza),
 * ogni negozio del carrello aperto adesso, almeno un fattorino approvato con l'interruttore
 * acceso. La usano le due rotte che creano l'ordine (rifiutano con un 409), la rotta
 * /api/consegna/veloce (che la cassa e il carrello leggono) e la riga del carrello. Se una lettura
 * non riesce, la veloce non si offre: mai promettere alla cieca.
 * Prova: tests/unit/la-consegna-veloce-si-vende-solo-se-c-e-un-fattorino.test.ts.
 */

/** La fascia salvata sull'ordine è la veloce? È l'ingresso `consegnaVeloce` del conto. */
export function eConsegnaVeloce(a: { fascia: string | null | undefined; ritiroInNegozio: boolean }): boolean {
  return !a.ritiroInNegozio && a.fascia === ETICHETTA_ADESSO;
}

export type EsitoVeloce = { possibile: true } | { possibile: false; perche: string };

const SCEGLI_UNA_FASCIA = 'Scegli una fascia oraria: la consegna arriva quando la scegli tu.';

export function veloceSiPuo(s: {
  /** L'ora di Piacenza (`romeNow()`), non quella del server. */
  adesso: Date;
  /** Gli orari dei negozi del carrello. `null` = la lettura non è riuscita. */
  negozi: Array<{ nome: string; orari: unknown }> | null;
  /** I fattorini approvati e online. `null` = la lettura non è riuscita. */
  fattoriniOnline: number | null;
}): EsitoVeloce {
  if (!expressSiPuo(s.adesso.getHours())) {
    return { possibile: false, perche: `La consegna veloce si fa dalle 8 alle 21. ${SCEGLI_UNA_FASCIA}` };
  }
  if (s.negozi === null || s.fattoriniOnline === null) {
    return { possibile: false, perche: `Adesso non riesco a confermare la consegna veloce. ${SCEGLI_UNA_FASCIA}` };
  }
  const chiuso = s.negozi.find((n) => !negozioPuoServire(n.orari, ETICHETTA_ADESSO, s.adesso));
  if (chiuso) {
    return { possibile: false, perche: `${chiuso.nome} adesso è chiuso: la consegna veloce non si può. ${SCEGLI_UNA_FASCIA}` };
  }
  if (s.fattoriniOnline < 1) {
    return { possibile: false, perche: `Adesso non c'è un fattorino libero per la consegna veloce. ${SCEGLI_UNA_FASCIA}` };
  }
  return { possibile: true };
}

/**
 * Quanti fattorini possono partire adesso: ruolo rider, approvati, interruttore acceso.
 * `null` se la lettura fallisce (chi chiama non offre la veloce). Serve il client di servizio:
 * i profili degli altri al cliente non si leggono.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function contaFattoriniOnline(db: SupabaseClient<any, any, any>): Promise<number | null> {
  try {
    const { count, error } = await db
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'rider')
      .eq('is_approved', true)
      .eq('rider_is_online', true);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/** La parola sotto la mattonella «Adesso»: «+1 €» da 10 € in su, «compresa» sotto i 10 €. */
export function prezzoDellaVeloce(supplementoCents: number): string {
  if (supplementoCents <= 0) return 'compresa';
  const euro = supplementoCents / 100;
  return Number.isInteger(euro) ? `+${euro} €` : `+${formatPrice(euro)}`;
}

/**
 * La riga del carrello «quando arriva». Promette i minuti SOLO se la veloce si può davvero (stessa
 * risposta della cassa e delle rotte) e l'orologio è ancora dentro le 8-21. `null` = non ancora
 * letto, o lettura fallita: nessun tempo promesso.
 */
export function rigaQuandoArrivaNelCarrello(ora: number | null, veloce: boolean | null): string | null {
  if (ora === null || veloce === null) return null;
  if (veloce && expressSiPuo(ora)) return `Consegna in ${EXPRESS_ETA_LABEL}`;
  return 'Consegna nella fascia che scegli in cassa';
}

/**
 * METTERE IN PAUSA UNA CAMPAGNA È SPENDERE SOLDI DI QUALCUN ALTRO — quindi si verifica.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * In `/admin/sponsored` i due pulsanti scrivevano così:
 *
 *     const { error } = await supabase.from('sponsored_listings').update({ status }).eq('id', id);
 *     if (error) throw error;                       // → poi onSuccess: toast.success('Aggiornato')
 *
 * L'errore lo guardava. Le righe toccate no. Con le regole di riga attive una scrittura senza
 * permesso non è un errore: è un comando che non trova niente da cambiare, e il database risponde
 * «ok, zero righe». A schermo compariva «Aggiornato», l'amministratore chiudeva la pagina convinto
 * di aver fermato la campagna, e la campagna continuava a spendere il budget del venditore. Lo
 * stesso per Elimina.
 *
 * ── La cura, e perché è un file e non una riga ───────────────────────────────────────────────
 * La pagina non costruisce più la scrittura: la chiede a queste due funzioni, che la costruiscono
 * sempre con `.select('id')` — cioè chiedendo indietro le righe toccate — e la passano INTERA a
 * `lib/esito-scrittura.ts`, che LANCIA se non è cambiato niente. Nessuno può più scrivere qui
 * dentro una scrittura senza prova, perché non c'è più il punto in cui la si scrive a mano.
 *
 * ── Il terzo difetto, sulla stessa riga ──────────────────────────────────────────────────────
 * Dopo la scrittura la pagina svuotava `queryKeys.admin.sponsored()`, che vale
 * `['admin','sponsored','all']`. Ma l'elenco che l'amministratore sta guardando, quando ha un
 * filtro acceso, sta sotto `['admin','sponsored','paused']`: la lista NON si ricaricava, e la
 * riga restava lì come prima con scritto «Aggiornato» sopra. Qui la chiave torna a essere il ramo
 * — `['admin','sponsored']` — che li copre tutti, filtro per filtro.
 *
 * 🟢 Puro: nessuna rete propria, nessun React, nessun orologio. Il collegamento al database
 * arriva da fuori, quindi una prova ESEGUE queste funzioni con un database finto.
 */

import { scrivi, type EsitoScrittura, type RispostaScrittura } from '../esito-scrittura';
import { nomeDellaCampagna, type Campagna, type StatoCampagna } from './vista-delle-campagne';

/**
 * Il minimo di `supabase-js` che serve per scrivere su una campagna.
 *
 * Non è il tipo del client vero — è molto più ricco — è la parte che queste due funzioni usano,
 * così una prova la può fingere senza tirarsi dietro una libreria intera.
 */
export interface FiltroScrivibile {
  eq(colonna: string, valore: string): { select(colonne: string): PromiseLike<RispostaScrittura> };
}

export interface TavoloCampagne {
  update(valori: Record<string, unknown>): FiltroScrivibile;
  delete(): FiltroScrivibile;
}

export interface DbCampagne {
  from(tabella: string): TavoloCampagne;
}

export const TABELLA_CAMPAGNE = 'sponsored_listings';

/**
 * Il ramo dell'archivio che tiene TUTTE le liste di campagne, un filtro per foglia.
 *
 * Va usato per svuotare la cache dopo una scrittura: essendo il ramo, colpisce anche la lista che
 * l'amministratore sta guardando in questo momento, qualunque filtro abbia acceso.
 */
export function chiaveDelleCampagne(): readonly string[] {
  return ['admin', 'sponsored'];
}

/** Mette in pausa, riprende o chiude una campagna — e pretende che sia successo davvero. */
export function cambiaStatoCampagna(
  db: DbCampagne,
  campagna: Pick<Campagna, 'id' | 'product' | 'seller'>,
  stato: StatoCampagna,
): Promise<EsitoScrittura> {
  return scrivi(
    () => db.from(TABELLA_CAMPAGNE).update({ status: stato }).eq('id', campagna.id).select('id'),
    { cosa: `La campagna «${nomeDellaCampagna(campagna)}»` },
  );
}

/** Cancella una campagna — e pretende che sia successo davvero. */
export function eliminaCampagna(
  db: DbCampagne,
  campagna: Pick<Campagna, 'id' | 'product' | 'seller'>,
): Promise<EsitoScrittura> {
  return scrivi(
    () => db.from(TABELLA_CAMPAGNE).delete().eq('id', campagna.id).select('id'),
    { cosa: `La campagna «${nomeDellaCampagna(campagna)}»` },
  );
}

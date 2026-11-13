/**
 * Il ripiego delle scritture della contestazione vinta: una migrazione alla volta, dalla più nuova.
 *
 * R23-012 — Stava in `dispute.ts`, che era arrivato al tetto di righe della prova di struttura
 * (tests/unit/webhook-diviso-per-mestiere.test.ts): spostato qui, uguale.
 */
import { logger } from '@/lib/logger';
import { senzaCampi } from '@/lib/db/migrazione-124';
import { colonnaNonTrovata, type ErroreDatabase } from '@/lib/db/migrazione-148';

/**
 * 15/10/2026 (collaudo, giro 2) — IL RIPIEGO NON SCATTAVA SULLE SCRITTURE.
 *
 * La contestazione vinta scrive `dispute_seller_reversed_cents`, una colonna
 * della migrazione 126 che in produzione non c'è ancora. Il ripiego di sempre
 * (`conRipiegoSchema`) riconosce i codici di PostgreSQL, ma su una scrittura
 * risponde prima PostgREST, con `PGRST204 — Could not find the '…' column`:
 * il ripiego non scattava, la scrittura obbligatoria lanciava, Stripe riprovava
 * per tre giorni e agli amministratori non arrivava più nessun avviso. Qui si
 * usa il riconoscimento che conosce anche quel codice (`colonnaNonTrovata`).
 *
 * E si toglie una migrazione alla volta, dalla più nuova. Il ripiego di prima
 * toglieva insieme la colonna della 126 e `payout_tentativo` (della 124, che in
 * produzione c'è): il bonifico tornava in coda col numero di tentativo vecchio,
 * cioè con la stessa chiave anti-doppione del bonifico già stornato, e Stripe
 * avrebbe restituito quello invece di farne uno nuovo. Il negozio vinceva la
 * contestazione e non veniva pagato.
 */
export async function scriviConRipiego<T extends { error: unknown }>(
  dove: string,
  valori: Record<string, unknown>,
  /** Le colonne recenti a gruppi, dalla migrazione più nuova alla più vecchia. */
  colonneRecenti: ReadonlyArray<readonly string[]>,
  esegui: (valori: Record<string, unknown>) => PromiseLike<T>,
): Promise<T> {
  let campi = valori;
  let esito = await esegui(campi);
  for (const gruppo of colonneRecenti) {
    if (!esito.error || !colonnaNonTrovata(esito.error as ErroreDatabase)) return esito;
    logger.warn('[stripe] colonna nuova non ancora nel database: riscrivo senza', {
      dove, senza: gruppo, codice: (esito.error as { code?: string }).code ?? null,
    });
    campi = senzaCampi(campi, gruppo);
    esito = await esegui(campi);
  }
  return esito;
}

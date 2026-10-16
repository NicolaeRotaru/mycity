import type { SupabaseClient } from '@supabase/supabase-js';
import { conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';
import { compensoDalContante, contanteDaRimettereCents } from '@/lib/shipping';
import { STATI_IN_CUI_SI_INCASSA } from '@/lib/rider/incasso-alla-consegna';
import { recordActivity } from '@/lib/activity';

/**
 * 15/10/2026 (R33) — L'INCASSO IN CONTANTI SI REGISTRA IN UN POSTO SOLO.
 *
 * Fino a oggi lo registrava solo il fattorino, da `/api/rider/cash-confirm`, e
 * le regole stavano dentro quella rotta. Se il fattorino chiudeva la consegna
 * senza dichiarare i contanti la rimessa saltava l'ordine e il negozio non
 * veniva pagato; dopo sette giorni l'ordine spariva dalla sua vista, e
 * l'amministratore leggeva «vanno chiesti al fattorino» senza un pulsante per
 * registrarlo lui.
 *
 * Adesso le strade sono due — il fattorino, e l'amministratore che registra
 * l'incasso dichiarato a voce dal fattorino, con nome e motivo nel registro — e
 * passano tutte e due da qui: stessi campi scritti, stessa guardia atomica,
 * stesso compenso trattenuto. Una regola sui soldi scritta due volte e' il
 * modo piu' sicuro di farle divergere.
 */

/** L'ordine come serve per decidere se l'incasso si puo' registrare. */
export type OrdineDaIncassare = {
  id: string;
  rider_id: string | null;
  total_price: number | string | null;
  rider_fee_cents: number | null;
  shipping_cost: number | string | null;
  pickup_in_store: boolean | null;
  payment_method: string | null;
  /** Serve a non riscrivere «pagato» su un ordine gia' rimborsato (`pagamentoDopoLIncasso`). */
  payment_status?: string | null;
  delivery_status: string;
  cash_confirmed_at: string | null;
  delivered_at?: string | null;
};

/** Le colonne da leggere per avere un `OrdineDaIncassare`. */
export const COLONNE_ORDINE_DA_INCASSARE =
  'id, rider_id, total_price, rider_fee_cents, shipping_cost, pickup_in_store, payment_method, payment_status, delivery_status, cash_confirmed_at, delivered_at';

export type ChiRegistra =
  | { chi: 'fattorino'; userId: string }
  | { chi: 'amministratore'; userId: string };

export type MotivoRifiuto =
  | 'NON_TROVATO'
  | 'DI_UN_ALTRO_FATTORINO'
  | 'NON_IN_CONTANTI'
  | 'GIA_CONFERMATO'
  | 'SENZA_FATTORINO'
  | 'NON_ANCORA_CONSEGNATO';

/**
 * Chi puo' registrare l'incasso di quale ordine.
 *
 * Il fattorino: solo i suoi ordini, e da quando ha la merce in mano — anche
 * dopo la consegna, e anche dopo i sette giorni in cui la regola di lettura
 * gli mostra i recapiti del cliente: l'incasso non e' un recapito, e un
 * incasso non dichiarato e' un negozio non pagato.
 *
 * L'amministratore: solo un ordine gia' consegnato da un fattorino. Mentre
 * l'ordine e' in strada i contanti li ha in mano il fattorino, ed e' lui che
 * li deve dichiarare.
 */
export function motivoPerNonRegistrare(
  ordine: OrdineDaIncassare | null,
  chi: ChiRegistra,
): MotivoRifiuto | null {
  if (!ordine) return 'NON_TROVATO';
  if (chi.chi === 'fattorino' && ordine.rider_id !== chi.userId) return 'DI_UN_ALTRO_FATTORINO';
  if (ordine.payment_method !== 'cod') return 'NON_IN_CONTANTI';
  if (ordine.cash_confirmed_at) return 'GIA_CONFERMATO';
  if (chi.chi === 'amministratore') {
    if (!ordine.rider_id) return 'SENZA_FATTORINO';
    if (ordine.delivery_status !== 'DELIVERED') return 'NON_ANCORA_CONSEGNATO';
  }
  return null;
}

/**
 * Gli stati dentro cui la scrittura e' ammessa, decisi dal database nella
 * stessa UPDATE: per il fattorino quelli in cui ha la merce, per
 * l'amministratore solo «consegnato».
 */
export function statiAmmessi(chi: ChiRegistra): readonly string[] {
  return chi.chi === 'amministratore' ? ['DELIVERED'] : STATI_IN_CUI_SI_INCASSA;
}

/** Sopra questa cifra il contante dichiarato e' un errore di battitura, non un incasso. */
export function importoFuoriMisura(ordine: OrdineDaIncassare, incassatoCents: number): boolean {
  return incassatoCents > contanteDaRimettereCents(ordine) * 2 + 1000;
}

export type DatiIncasso = {
  incassatoCents: number;
  fotoContanti?: string | null;
  firma?: string | null;
  fotoConsegna?: string | null;
  /** Chi registra: il fattorino stesso, o l'amministratore al suo posto. */
  registratoDa: string;
  adesso: Date;
};

/**
 * 16/10/2026 — «PAGATO» SOLO SU UN ORDINE ANCORA DA PAGARE.
 *
 * L'incasso scriveva sempre `payment_status: 'PAID'`. Il caso: lunedi' un
 * ordine in contanti viene consegnato senza incasso dichiarato; mercoledi' il
 * cliente fa un reso parziale e il rimborso scrive PARTIALLY_REFUNDED; giovedi'
 * l'amministratore registra i contanti e l'ordine torna «PAID», col rimborso
 * sparito dal suo stato. Su un rimborso pieno (REFUNDED) le metriche del
 * negozio tornavano a contarlo come venduto.
 *
 * Restituisce lo stato da scrivere: 'PAID' se l'ordine era ancora da pagare
 * (PENDING, o mai impostato), altrimenti `null` = non si tocca.
 */
export function pagamentoDopoLIncasso(statoLetto: string | null | undefined): 'PAID' | null {
  return statoLetto == null || statoLetto === 'PENDING' ? 'PAID' : null;
}

/** I campi che chiudono l'incasso sull'ordine, uguali per tutte le strade. */
export function campiDellIncasso(ordine: OrdineDaIncassare, dati: DatiIncasso): Record<string, unknown> {
  // 155 / R120 — il compenso il fattorino se lo tiene dal contante; se il
  // contante non basta, il pezzo scoperto resta 'HELD' e gli arriva per
  // bonifico (FILTRO_RIDER_RITENTABILI), invece di sparire.
  const { trattenutoCents, residuoDovutoCents } = compensoDalContante(ordine);
  // L'ordine in contanti diventa PAGATO qui, che e' il momento in cui i soldi
  // sono passati di mano — ma solo se era ancora da pagare: un rimborso gia'
  // registrato resta scritto.
  const pagamento = pagamentoDopoLIncasso(ordine.payment_status);
  return {
    cash_collected_cents: dati.incassatoCents,
    cash_photo_url: dati.fotoContanti ?? null,
    cash_signature_url: dati.firma ?? null,
    delivery_photo_url: dati.fotoConsegna ?? null,
    cash_confirmed_at: dati.adesso.toISOString(),
    cash_collected_by: dati.registratoDa,
    ...(pagamento ? { payment_status: pagamento } : {}),
    rider_payout_status: residuoDovutoCents > 0 ? 'HELD' : trattenutoCents > 0 ? 'CASH_WITHHELD' : null,
    rider_payout_at: residuoDovutoCents === 0 && trattenutoCents > 0 ? dati.adesso.toISOString() : null,
  };
}

/** I due campi che nascono con la migrazione 124: senza, si scrive il resto. */
const CAMPI_COMPENSO = ['rider_payout_status', 'rider_payout_at'] as const;

/**
 * La scrittura, con la guardia dentro la UPDATE: vince solo chi trova ancora
 * l'incasso vuoto (due conferme insieme non sovrascrivono le prove), solo sul
 * fattorino dell'ordine, e solo negli stati ammessi. Zero righe = qualcun
 * altro e' arrivato prima, o l'ordine non e' piu' dove si credeva.
 *
 * Quando scrive «PAID», lo scrive solo se lo stato di pagamento e' ancora
 * quello letto: un rimborso arrivato fra la lettura e la scrittura non viene
 * coperto (zero righe, e chi riprova rilegge l'ordine com'e' adesso).
 */
export async function scriviIncasso(
  admin: SupabaseClient,
  ordine: { id: string; rider_id: string; payment_status?: string | null },
  campi: Record<string, unknown>,
  chi: ChiRegistra,
): Promise<{ data: Array<{ id: string }> | null; error: { message?: string } | null }> {
  const stati = [...statiAmmessi(chi)];
  const conferma = (valori: Record<string, unknown>) => {
    const q = admin
      .from('orders')
      .update(valori)
      .eq('id', ordine.id)
      .eq('rider_id', ordine.rider_id)
      .is('cash_confirmed_at', null)
      .in('delivery_status', stati);
    // Chi non ha letto lo stato (undefined) non ha niente da confrontare.
    if (valori.payment_status !== 'PAID' || ordine.payment_status === undefined) return q.select('id');
    return (ordine.payment_status === null
      ? q.is('payment_status', null)
      : q.eq('payment_status', ordine.payment_status)
    ).select('id');
  };

  const esito = await conRipiegoSchema(
    'orders.update (conferma incasso)',
    () => conferma(campi),
    () => conferma(senzaCampi(campi, CAMPI_COMPENSO)),
  );
  return esito as unknown as { data: Array<{ id: string }> | null; error: { message?: string } | null };
}

/**
 * 16/10/2026 — Da 50 euro in su senza foto dei contanti: la nota del fattorino
 * resta nel registro delle attivita', legata all'ordine (`activity_events`, la
 * stessa sorveglianza che rispecchia il registro amministrativo). L'avviso agli
 * amministratori lo scrive la rotta, fra gli avvisi di servizio.
 */
export async function tracciaIncassoSenzaFoto(dati: {
  fattorinoId: string;
  ordineId: string;
  nota: string | null;
  incassatoCents: number;
  attesoCents: number;
}): Promise<void> {
  await recordActivity({
    category: 'commerce',
    eventType: 'order.cash_without_photo',
    summary: 'Incasso in contanti senza foto, con la nota del fattorino',
    actorId: dati.fattorinoId,
    targetTable: 'orders',
    targetId: dati.ordineId,
    metadata: { nota: dati.nota, incassato_cents: dati.incassatoCents, atteso_cents: dati.attesoCents },
  });
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';
import { compensoDalContante, contanteDaRimettereCents } from '@/lib/shipping';
import { STATI_IN_CUI_SI_INCASSA } from '@/lib/rider/incasso-alla-consegna';

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
  delivery_status: string;
  cash_confirmed_at: string | null;
  delivered_at?: string | null;
};

/** Le colonne da leggere per avere un `OrdineDaIncassare`. */
export const COLONNE_ORDINE_DA_INCASSARE =
  'id, rider_id, total_price, rider_fee_cents, shipping_cost, pickup_in_store, payment_method, delivery_status, cash_confirmed_at, delivered_at';

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

/** I campi che chiudono l'incasso sull'ordine, uguali per tutte le strade. */
export function campiDellIncasso(ordine: OrdineDaIncassare, dati: DatiIncasso): Record<string, unknown> {
  // 155 / R120 — il compenso il fattorino se lo tiene dal contante; se il
  // contante non basta, il pezzo scoperto resta 'HELD' e gli arriva per
  // bonifico (FILTRO_RIDER_RITENTABILI), invece di sparire.
  const { trattenutoCents, residuoDovutoCents } = compensoDalContante(ordine);
  return {
    cash_collected_cents: dati.incassatoCents,
    cash_photo_url: dati.fotoContanti ?? null,
    cash_signature_url: dati.firma ?? null,
    delivery_photo_url: dati.fotoConsegna ?? null,
    cash_confirmed_at: dati.adesso.toISOString(),
    cash_collected_by: dati.registratoDa,
    // L'ordine in contanti diventa PAGATO qui, che e' il momento in cui i
    // soldi sono passati di mano.
    payment_status: 'PAID',
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
 */
export async function scriviIncasso(
  admin: SupabaseClient,
  ordine: { id: string; rider_id: string },
  campi: Record<string, unknown>,
  chi: ChiRegistra,
): Promise<{ data: Array<{ id: string }> | null; error: { message?: string } | null }> {
  const stati = [...statiAmmessi(chi)];
  const conferma = (valori: Record<string, unknown>) =>
    admin
      .from('orders')
      .update(valori)
      .eq('id', ordine.id)
      .eq('rider_id', ordine.rider_id)
      .is('cash_confirmed_at', null)
      .in('delivery_status', stati)
      .select('id');

  const esito = await conRipiegoSchema(
    'orders.update (conferma incasso)',
    () => conferma(campi),
    () => conferma(senzaCampi(campi, CAMPI_COMPENSO)),
  );
  return esito as unknown as { data: Array<{ id: string }> | null; error: { message?: string } | null };
}

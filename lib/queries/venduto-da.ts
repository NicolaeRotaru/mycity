import { logger } from '@/lib/logger';
import { eSchemaIndietro } from '@/lib/db/migrazione-124';
import type { LettoreVista } from '@/lib/queries/seller-public-profiles';

/**
 * «VENDUTO DA»: chi vende davvero, letto dalla vista pubblica dei negozi.
 *
 * 15/10/2026 (R55) — IN PRODUZIONE IL RIQUADRO SPARIVA, E NESSUNO LO SAPEVA.
 *
 * Il riquadro chiede alla vista `seller_public_profiles` ragione sociale, forma,
 * partita IVA e sede. Quelle colonne le aggiunge la migrazione 126, che in
 * produzione non e' applicata. PostgREST, davanti a una sola colonna che non
 * esiste, fa fallire la domanda intera: il componente ignorava l'errore, il dato
 * restava vuoto e il riquadro non si disegnava. Nessuna riga nei log. Il cliente
 * leggeva solo «Venduto e consegnato da Pane Quotidiano», e chi guardava i log
 * non vedeva niente da guardare.
 *
 * Adesso:
 *  · se la vista non ha ancora le colonne d'impresa, si scrive un avviso che dice
 *    quale migrazione manca, e si mostra quello che la vista ha di sicuro:
 *    insegna, indirizzo del negozio, telefono. Meglio una riga in meno che una
 *    riga finta, ma meglio una riga vera che nessun riquadro;
 *  · se la lettura fallisce per un altro motivo, si scrive l'errore e la domanda
 *    fallisce: non torna «riuscita e vuota».
 *
 * Quello che il codice non puo' fare da solo resta a Nicola: applicare la 126 e
 * far compilare al negozio ragione sociale, sede e partita IVA.
 */

export type DatiVendutoDa = {
  store_name: string | null;
  business_legal_name: string | null;
  business_form: string | null;
  business_vat_number: string | null;
  business_address: string | null;
  business_city: string | null;
  business_zip: string | null;
  store_address: string | null;
  store_phone: string | null;
};

/** Le colonne che la vista ha anche in produzione, senza la migrazione 126. */
const COLONNE_DI_BASE = 'store_name, store_address, store_phone';

/** Le colonne d'impresa che arrivano con la migrazione 126. */
const COLONNE_IMPRESA = [
  'business_legal_name',
  'business_form',
  'business_vat_number',
  'business_address',
  'business_city',
  'business_zip',
] as const;

const IMPRESA_VUOTA = Object.fromEntries(COLONNE_IMPRESA.map((c) => [c, null])) as Pick<
  DatiVendutoDa,
  (typeof COLONNE_IMPRESA)[number]
>;

type Risposta = { data: unknown; error: unknown };

function codiceDi(errore: unknown): string | undefined {
  return (errore as { code?: string } | null)?.code;
}

function messaggioDi(errore: unknown): string | undefined {
  const m = (errore as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : undefined;
}

/** Il venditore di un negozio, per il riquadro «Venduto da». `null` se la vista non lo mostra. */
export async function leggiVendutoDa(supa: LettoreVista, sellerId: string): Promise<DatiVendutoDa | null> {
  const completa: Risposta = await supa
    .from('seller_public_profiles')
    .select(`${COLONNE_DI_BASE}, ${COLONNE_IMPRESA.join(', ')}`)
    .eq('id', sellerId)
    .maybeSingle();

  if (!completa.error) return (completa.data as DatiVendutoDa | null) ?? null;

  if (!eSchemaIndietro(completa.error)) {
    logger.error('[venduto-da] la vista pubblica dei negozi non risponde: il riquadro «Venduto da» non si disegna', {
      sellerId,
      codice: codiceDi(completa.error),
      motivo: messaggioDi(completa.error),
    });
    throw completa.error;
  }

  logger.warn(
    '[venduto-da] la vista pubblica dei negozi non ha ancora ragione sociale, partita IVA e sede (migrazione 126 non applicata): mostro insegna, indirizzo e telefono',
    { sellerId, codice: codiceDi(completa.error) },
  );
  const ridotta: Risposta = await supa
    .from('seller_public_profiles')
    .select(COLONNE_DI_BASE)
    .eq('id', sellerId)
    .maybeSingle();
  if (ridotta.error) {
    logger.error('[venduto-da] anche la lettura ridotta della vista pubblica dei negozi e fallita', {
      sellerId,
      codice: codiceDi(ridotta.error),
      motivo: messaggioDi(ridotta.error),
    });
    throw ridotta.error;
  }
  if (!ridotta.data) return null;
  return { ...IMPRESA_VUOTA, ...(ridotta.data as Pick<DatiVendutoDa, 'store_name' | 'store_address' | 'store_phone'>) };
}

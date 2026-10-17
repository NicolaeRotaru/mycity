import {
  fetchSellerPublicMap,
  negozioApprovato,
  type LettoreVista,
} from '@/lib/queries/seller-public-profiles';

/**
 * IL NEGOZIO DEL MESE, CON IL NEGOZIO LETTO DALLA VETRINA PUBBLICA.
 *
 * 15/10/2026 (R3, secondo giro) — Il riquadro in home e la pagina «Negozio del
 * mese» agganciavano il negozio alla tabella `profiles`, e senza negozio non si
 * disegnavano. La migrazione 161, in attesa di firma, chiude `profiles` a chi non
 * e' il proprietario: per ogni cliente l'aggancio torna vuoto e il riquadro della
 * home spariva in silenzio, anche con un negozio scelto per il mese.
 *
 * Adesso il negozio arriva dalla vista `seller_public_profiles`. La regola resta
 * quella di prima: un negozio che la vetrina non mostra (non approvato, sospeso)
 * non si mette in evidenza.
 */

export type NegozioDelMese = {
  id: string;
  cover_image_url: string | null;
  headline: string | null;
  story: string | null;
  discount_code: string | null;
  discount_percent: number | null;
  month: string;
  seller: { id: string; store_name: string | null; store_logo: string | null } | null;
};

type RigaDelMese = Omit<NegozioDelMese, 'seller'> & { seller_id: string | null };

/** La scelta del mese (`mese` = primo giorno del mese, fuso di Piacenza), o `null`. */
export async function leggiNegozioDelMese(supa: LettoreVista, mese: string): Promise<NegozioDelMese | null> {
  const { data } = await supa
    .from('shop_of_month')
    .select('id, cover_image_url, headline, story, discount_code, discount_percent, month, seller_id')
    .eq('month', mese)
    .maybeSingle();
  const riga = (data ?? null) as RigaDelMese | null;
  if (!riga) return null;

  const negozi = await fetchSellerPublicMap(supa, [riga.seller_id], 'id, store_name, store_logo');
  const negozio = riga.seller_id ? negozi.get(riga.seller_id) : undefined;
  const { seller_id: _sellerId, ...scelta } = riga;
  return {
    ...scelta,
    seller: negozio && negozioApprovato(negozio)
      ? { id: negozio.id, store_name: negozio.store_name ?? null, store_logo: negozio.store_logo ?? null }
      : null,
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { leggiPerMetadati } from '@/lib/supabase/lettura-per-metadati';

/**
 * QUELLO CHE GOOGLE E WHATSAPP LEGGONO DI UN PRODOTTO E DI UN NEGOZIO.
 *
 * 15/10/2026 (R3) — Il guscio della scheda prodotto, la sua anteprima da
 * condividere e l'anteprima del negozio leggevano il negozio da `profiles`. Con
 * la migrazione 161 quella tabella si chiude a chi non e' il proprietario, e il
 * lettore di questi file e' sempre un estraneo: il crawler di Google, il robot
 * di WhatsApp. Il risultato sarebbe stato «noindex» su ogni scheda — il prodotto
 * sparisce dalla ricerca — e anteprime con «Negozio su MyCity» al posto del nome
 * e del logo.
 *
 * Qui il negozio arriva dalla vista pubblica `seller_public_profiles`, che regge
 * prima e dopo la 161, e chiede solo colonne che esistono anche nella vista di
 * produzione (senza la migrazione 126).
 */

export type ProdottoPerMetadati = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  images: string[] | null;
  status: string;
  stock: number | null;
  seller_id: string | null;
  profiles: { store_name: string | null; is_approved: boolean } | null;
};

/** Il prodotto per titolo, anteprima e dati strutturati, col suo negozio pubblico. */
export async function leggiProdottoPerMetadati(
  id: string,
  client?: SupabaseClient,
): Promise<ProdottoPerMetadati | null> {
  const prodotto = await leggiPerMetadati<Omit<ProdottoPerMetadati, 'profiles'>>(
    'products',
    'id, name, description, price, images, status, stock, seller_id',
    { id },
    client,
  );
  if (!prodotto) return null;

  // La vista mostra solo i negozi approvati: se non risponde, per chi guarda da
  // fuori il negozio non c'e', ed e' giusto che la scheda non si indicizzi.
  const negozio = prodotto.seller_id
    ? await leggiPerMetadati<{ store_name: string | null; is_approved: boolean }>(
        'seller_public_profiles',
        'store_name, is_approved',
        { id: prodotto.seller_id },
        client,
      )
    : null;

  return { ...prodotto, profiles: negozio };
}

/**
 * La scheda va su Google solo se si puo' comprare: prodotto disponibile e negozio
 * approvato. Un «noindex» su un prodotto vendibile lo fa sparire dalla ricerca.
 */
export function prodottoDaIndicizzare(p: Pick<ProdottoPerMetadati, 'status' | 'profiles'>): boolean {
  // Niente import da altri moduli del catalogo: questo file gira anche sul
  // runtime edge delle anteprime, e deve restare leggero.
  return p.status === 'available' && p.profiles?.is_approved === true;
}

export type NegozioPerAnteprima = {
  store_name: string | null;
  store_description: string | null;
  store_logo: string | null;
};

/**
 * Il negozio per l'anteprima del link: nome, descrizione e logo dalla vista
 * pubblica. La citta' non c'e' nella vista e non serve: l'anteprima dice
 * «Piacenza», che e' dove MyCity vende.
 */
export function leggiNegozioPerAnteprima(id: string, client?: SupabaseClient): Promise<NegozioPerAnteprima | null> {
  return leggiPerMetadati<NegozioPerAnteprima>(
    'seller_public_profiles',
    'store_name, store_description, store_logo',
    { id },
    client,
  );
}

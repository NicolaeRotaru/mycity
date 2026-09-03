import type { Metadata } from 'next';
import { leggiPerMetadati } from '@/lib/supabase/lettura-per-metadati';
import { HydrationBoundary } from '@tanstack/react-query';
import { precaricaNegozio } from '@/lib/queries/precarico';

export const revalidate = 300;

type StoreMeta = {
  id: string;
  store_name: string | null;
  store_description: string | null;
  store_logo: string | null;
  store_address: string | null;
  is_approved: boolean;
  role: string | null;
};

/**
 * 27/8/2026 (R010) — qui si leggevano le variabili di Supabase a mano e, se mancavano, si tornava
 * `null` in silenzio: Google riceveva «Negozio non trovato» con noindex su una scheda vera, senza
 * un errore da nessuna parte. Adesso la lettura passa da `lib/supabase/lettura-per-metadati.ts`,
 * che con le variabili mancanti si ferma e dice quali.
 */
const fetchStore = (id: string) =>
  leggiPerMetadati<StoreMeta>(
    'seller_public_profiles',
    'id, store_name, store_description, store_logo, store_address, is_approved, role',
    { id },
  );

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const store = await fetchStore(params.id);
  if (!store || store.role !== 'seller' || !store.is_approved) {
    return { title: 'Negozio non trovato · MyCity', robots: { index: false } };
  }
  const name = store.store_name ?? 'Negozio';
  const desc =
    (store.store_description ?? `Compra online da ${name} su MyCity. Consegna locale in 30-60 minuti o ritiro in negozio.`).slice(0, 160);
  const img = store.store_logo ? [store.store_logo] : undefined;

  const cityHint = store.store_address ? ' a Piacenza' : '';
  return {
    title: `${name}${cityHint} — Acquista online · MyCity Piacenza`,
    description: desc,
    openGraph: {
      title: name,
      description: desc,
      images: img,
      type: 'website',
      siteName: 'MyCity',
    },
    twitter: { card: 'summary', title: name, description: desc, images: img },
    alternates: { canonical: `/store/${params.id}` },
  };
}

/**
 * 3/9/2026 — LA PAGINA DEL NEGOZIO ARRIVAVA VUOTA E SI RIEMPIVA DOPO.
 *
 * La vetrina e' un componente del browser: nome, orari, copertina e sezioni se
 * li andava a prendere DOPO aver scaricato ed eseguito il JavaScript. Chi
 * apriva un negozio da un telefono in 4G vedeva quindi lo scheletro del server,
 * poi la pagina che si svuotava per l'attesa del browser, e solo alla fine il
 * negozio. Tre impaginazioni in fila fanno pensare che il sito sia rotto.
 *
 * Qui siamo nel guscio, che gira sul server: la lettura la fa adesso e la
 * consegna dentro la pagina. Quando il codice della vetrina parte, la risposta
 * e' gia' in mano e non si va in rete.
 *
 * La domanda e' la STESSA che fa la pagina — vive in `lib/queries/catalogo.ts`
 * e la usano tutte e due — perche' se le chiavi non coincidessero il browser
 * non riconoscerebbe quello che ha ricevuto e rileggerebbe tutto lo stesso: un
 * viaggio in piu' invece di uno in meno, e nessuno se ne accorgerebbe.
 *
 * Vale anche per le pagine su misura del negozio (`[slug]`), che stanno sotto
 * questo stesso guscio e leggono lo stesso profilo.
 *
 * Il precarico non puo' far fallire la pagina: se il server non riesce a
 * leggere, consegna uno stato vuoto e il browser fa quello che faceva prima.
 */
export default async function StoreLayout(
  props: { children: React.ReactNode; params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const precarico = await precaricaNegozio(params.id);

  return <HydrationBoundary state={precarico}>{props.children}</HydrationBoundary>;
}

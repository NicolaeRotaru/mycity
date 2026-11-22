import type { Metadata } from 'next';
import { leggiPerMetadati } from '@/lib/supabase/lettura-per-metadati';
import { fraseComeArriva } from '@/lib/promesse-pubbliche';
import { descrizioneDelNegozio } from '@/lib/queries/metadati-vetrina';
import { HydrationBoundary } from '@tanstack/react-query';
import { precaricaNegozio } from '@/lib/queries/precarico';
import { notFound } from 'next/navigation';

/**
 * 21/11/2026 (R10-004) — LA VETRINA SI COSTRUISCE A OGNI VISITA, MAI DA UNA COPIA IN CACHE.
 *
 * Qui c'era `revalidate = 300`: una copia della vetrina tenuta fino a cinque minuti, e poi servita
 * ancora alla prima visita dopo (Next la rifà dietro le quinte, ma a quella visita dà la vecchia).
 * La vetrina dipende dall'orologio: l'annuncio «fino al 21» vale tutto il 21 a Piacenza e sparisce
 * a mezzanotte (`announcementActive`, col giorno di Piacenza), e anche «Aperto ora / Chiuso ora».
 * Una copia fatta alle 23:58 e servita la mattina dopo — dopo una notte senza visite, anche ore
 * dopo — mostrava l'annuncio già scaduto. Con 0 la pagina si costruisce alla visita, con l'ora di
 * quella visita; vale anche per le pagine su misura qui sotto (vince il valore più basso).
 * Oggi `force-dynamic` in app/layout.tsx fa già lo stesso per tutto il sito: questa riga è perché
 * regga anche quando quella verrà tolta.
 */
export const revalidate = 0;

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
  // 17/11/2026 — Il titolo dice «non trovata» con parole sue, diverse dal riquadro della pagina
  // («Negozio non trovato», in app/store/[id]/page.tsx): Next manda i metadati in streaming dentro il
  // corpo, e con le stesse parole la scritta compariva due volte, come alla 404 prima della sua cura.
  if (!store || store.role !== 'seller' || !store.is_approved) {
    return { title: 'Vetrina non trovata · MyCity', robots: { index: false }, alternates: { canonical: null } };
  }
  const name = store.store_name ?? 'Negozio';
  // 3/9/2026 — QUI SI PROMETTEVA IL RITIRO IN NEGOZIO, CHE ALLA CASSA NON C'E'.
  // Questa descrizione e' quello che si legge nel risultato di Google e nell'anteprima quando il
  // negoziante incolla il link del suo negozio su WhatsApp: e' il primo contatto, e prometteva
  // un'opzione spenta (`RITIRO_IN_NEGOZIO_ATTIVO`). Ora la frase nasce dall'interruttore, in
  // lib/promesse-pubbliche.ts, insieme ai minuti che stanno in lib/delivery.ts.
  const desc =
    descrizioneDelNegozio(name, store.store_description, fraseComeArriva());
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
  // R10-001 — La stessa riga dei metadati (una lettura sola, vedi lettura-per-metadati.ts). Un
  // guasto non è «non trovato»: si lascia la pagina com'era, e il suo «Riprova».
  const lettura = fetchStore(params.id).catch(() => undefined);
  const precarico = await precaricaNegozio(params.id);
  const store = await lettura;
  // R10-001 — Un negozio che non c'è risponde 404 davvero: qui siamo nel guscio, e sopra non c'è più
  // nessuna attesa (né app/loading.tsx né app/store/loading.tsx) che faccia partire la risposta con
  // «tutto ok» prima di saperlo. La condizione è quella con cui la pagina dice «Negozio non trovato».
  if (store === null || (store && (store.role !== 'seller' || !store.is_approved || !store.store_name))) notFound();

  return <HydrationBoundary state={precarico}>{props.children}</HydrationBoundary>;
}

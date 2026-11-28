import type { Metadata } from 'next';
import {
  disponibilitaPerGoogle,
  leggiProdottoPerMetadati,
  prodottoDaIndicizzare,
  type ProdottoPerMetadati,
} from '@/lib/queries/metadati-vetrina';
import { env } from '@/lib/env';
import { sizedImage } from '@/lib/image-url';
import { precaricoFoto } from '@/lib/preload-foto';
import { HydrationBoundary, type DehydratedState } from '@tanstack/react-query';
import { precaricaProdotto } from '@/lib/queries/precarico';
import { queryKeys } from '@/lib/queries/keys';
import type { SchedaProdotto } from '@/lib/queries/catalogo';
import { notFound } from 'next/navigation';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { discountedUnitCents, fetchActiveDiscounts } from '@/lib/promotions';

/**
 * 28/11/2026 (R04-013) — NESSUNA CACHE DICHIARATA CHE NON C'È.
 * Qui c'era `revalidate = 300`, ma `dynamic = 'force-dynamic'` in app/layout.tsx (la parola
 * d'ordine degli script, vedi lì) costruisce ogni pagina a ogni visita: la cache dichiarata non
 * contava, e chi leggeva credeva che la scheda arrivasse da una copia. E il giorno in cui quella riga
 * verrà tolta, una copia di 300 secondi mostrerebbe prezzo, sconto e disponibilità di cinque minuti prima. Con 0 la dichiarazione dice il
 * vero oggi e regge domani, come la vetrina (app/store/[id]/layout.tsx, R10-004). Una cache vera
 * delle letture, come quella della home (unstable_cache), è una scelta di Nicola: quanto vecchio
 * può essere la scheda che il cliente vede.
 */
export const revalidate = 0;

/**
 * R10-001 — UN PRODOTTO CHE NON ESISTE RISPONDE 404, NON «TUTTO OK».
 *
 * La lettura pubblica vede solo i prodotti in vendita di un negozio approvato: «niente» vuol dire
 * sia «non esiste» sia «esiste ma ora non si vende» (finito per oggi, in bozza, negozio sospeso).
 * Il secondo caso deve restare la pagina «Prodotto non disponibile», che spiega cosa succede; solo
 * il primo è una 404. Qui si chiede l'id e basta, senza le regole di lettura: vero solo se la riga
 * non c'è proprio. Se non si riesce a chiederlo si risponde «non lo so» (false): la pagina resta
 * quella di prima, mai una 404 per un guasto.
 */
async function prodottoInesistente(id: string): Promise<boolean> {
  try {
    const { data, error } = await getAdminSupabase().from('products').select('id').eq('id', id).maybeSingle();
    // 22P02 = un id che non è nemmeno un UUID: un prodotto così non c'è.
    if (error) {
      if ((error as { code?: string }).code === '22P02') return true;
      logger.warn('[scheda] non so se il prodotto esiste: niente 404', { id, code: (error as { code?: string }).code });
      return false;
    }
    return !data;
  } catch (e) {
    logger.warn('[scheda] non so se il prodotto esiste: niente 404', { id, errore: e instanceof Error ? e.message : 'errore' });
    return false;
  }
}

// 27/8/2026 (R010) — vedi `lib/supabase/lettura-per-metadati.ts`: prima, con le variabili
// mancanti, questa pagina rispondeva «prodotto non trovato» senza dire niente a nessuno.
// 15/10/2026 (R3) — il negozio arriva dalla vista pubblica, non da `profiles`: chi legge
// questi metadati e' sempre un estraneo (Google, WhatsApp), e dopo la migrazione 161
// `profiles` per lui e' chiusa. Ogni scheda avrebbe preso «noindex».
const fetchProduct = (id: string) => leggiProdottoPerMetadati(id);

/**
 * R11-002 — Lo sconto della promozione attiva, dalla stessa fonte di griglia, scheda e cassa
 * (`fetchActiveDiscounts`), letto col client anonimo come lo leggerebbe un estraneo. Una lettura che
 * cade vale «nessuno sconto»: i dati strutturati restano col prezzo pieno, come prima, e la pagina
 * si apre lo stesso. Non lancia mai: la si può far partire subito e aspettare dopo.
 */
async function scontoAttivo(id: string): Promise<number> {
  try {
    return (await fetchActiveDiscounts(creaClientAnonimo(), [id])).get(id) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 22/11/2026 — I METADATI DALLA STESSA RISPOSTA DEL PRECARICO.
 *
 * I metadati rileggevano il prodotto e il suo negozio che il precarico aveva appena letto, con
 * altre colonne: a ogni visita `products` due volte e `seller_public_profiles` due volte. La scheda
 * del precarico ha già tutto quello che serve qui (nome, descrizione, foto, prezzo, stato, scorte,
 * insegna e approvazione del negozio), e il precarico si fa una volta per richiesta
 * (`lib/queries/precarico.ts`). Si rilegge con `fetchProduct` solo quando il precarico non ha la
 * scheda: il precarico non fallisce mai (un guasto lo lascia vuoto), e solo quella lettura sa
 * distinguere «non c'è» da «non riesco a leggerlo» — un guasto non deve diventare «non trovato».
 */
function prodottoDalPrecarico(stato: DehydratedState, id: string): ProdottoPerMetadati | null {
  const chiave = JSON.stringify(queryKeys.products.detail(id));
  // Uno stato senza voci (precarico vuoto) non ha la scheda.
  const voce = (stato?.queries ?? []).find((q) => JSON.stringify(q.queryKey) === chiave);
  const s = voce?.state.data as SchedaProdotto | null | undefined;
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    price: Number(s.price),
    images: s.images,
    status: s.status as string,
    stock: s.stock,
    seller_id: s.seller_id,
    profiles: s.profiles ? { store_name: s.profiles.store_name, is_approved: s.profiles.is_approved === true } : null,
  };
}

/** Il prodotto per metadati e guscio: dal precarico della richiesta, o letto se lì non c'è. */
async function prodottoDellaRichiesta(id: string, precarico?: DehydratedState): Promise<ProdottoPerMetadati | null> {
  return prodottoDalPrecarico(precarico ?? (await precaricaProdotto(id)), id) ?? fetchProduct(id);
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const product = await prodottoDellaRichiesta(params.id);
  if (!product) {
    // 5/11/2026 — canonical nullo: senza, la pagina «non trovato» ereditava quello della home,
    // e noindex più canonical alla home sono due segnali in contraddizione.
    return { title: 'Prodotto non trovato · MyCity', robots: { index: false }, alternates: { canonical: null } };
  }
  const storeName = product.profiles?.store_name ?? 'MyCity';
  const img = Array.isArray(product.images) && product.images[0] ? [product.images[0]] : undefined;
  const desc =
    (product.description ?? `${product.name} su MyCity. Acquisto da ${storeName}, consegna a casa all'ora che scegli.`).slice(0, 160);

  return {
    title: `${product.name} — ${storeName} a Piacenza · MyCity`,
    description: desc,
    openGraph: {
      title: product.name,
      description: desc,
      images: img,
      type: 'website',
      siteName: 'MyCity',
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
      description: desc,
      images: img,
    },
    // Niente indicizzazione se il negozio non è approvato o il prodotto non è disponibile
    robots: prodottoDaIndicizzare(product)
      ? undefined
      : { index: false },
    alternates: { canonical: `/product/${params.id}` },
  };
}

/**
 * #83 — LA SCHEDA ARRIVAVA AL CRAWLER SENZA CONTENUTO NELL'HTML.
 *
 * I dati strutturati del prodotto — nome, prezzo, disponibilità, negozio —
 * erano scritti dentro la pagina, che è un componente client: esistono solo
 * dopo che il JavaScript è stato scaricato e avviato. Google esegue il
 * JavaScript, ma in una seconda passata e non sempre: un prezzo che compare al
 * secondo giro è un prezzo che nei risultati può mancare.
 *
 * Qui il guscio è un componente server: quello che scrive finisce nell'HTML,
 * subito, senza aspettare niente. È la fetta di lavoro che si poteva fare senza
 * riscrivere le milleduecento righe della pagina.
 *
 * Il resto della pagina resta client: convertirla per intero è un lavoro a sé,
 * e senza poterla aprire in un browser non si fa alla cieca.
 */
export default async function ProductLayout(
  props: { children: React.ReactNode; params: Promise<{ id: string }> },
) {
  const params = await props.params;
  // 15/10/2026 (R3, R55) — Le due letture partono insieme: i metadati (prodotto, poi
  // il suo negozio) e il precarico. Il precarico chiede il prodotto e poi, in UNA
  // domanda alla vista pubblica, il negozio della scheda e «Venduto da»
  // (`lib/queries/scheda-con-venduto-da.ts`). Il guscio aspetta quindi due viaggi in
  // fila, come prima del 15/10. Finche' in produzione manca la migrazione 126, la
  // prima scheda aperta da un processo ne aspetta tre; le altre, per dieci minuti,
  // due. Non e' misurato in rete.
  //
  // 16/10/2026 — Qui c'era scritto che la pagina resta in cache cinque minuti e che
  // l'attesa la paga solo chi la rigenera. Non e' vero: `app/layout.tsx` dichiara
  // `dynamic = 'force-dynamic'` per tutto il sito, e con quello il `revalidate` qui
  // sopra non conta. Il guscio gira a OGNI visita: ogni viaggio in piu' lo paga chi
  // apre la scheda.
  //
  // 22/11/2026 — Una lettura sola: il prodotto per i metadati e la 404 viene dalla risposta del
  // precarico (vedi `prodottoDalPrecarico`), non da una seconda domanda allo stesso prodotto.
  // R11-002 — Lo sconto parte insieme al precarico, non in fila dopo.
  const scontoInArrivo = scontoAttivo(params.id);
  const precarico = await precaricaProdotto(params.id);
  const product = await prodottoDellaRichiesta(params.id, precarico);
  // R10-001 — Qui, nel guscio, si decide la 404. Arriva in rete solo quando sopra non c'è nessuna
  // attesa: oggi app/loading.tsx c'è ancora e fa partire la risposta con 200, quindi notFound()
  // arriva in streaming. Va tolto insieme alle prove comuni che lo leggono per nome.
  if (!product && (await prodottoInesistente(params.id))) notFound();

  const sconto = product ? await scontoInArrivo : 0;
  const schema = product && {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.id,
    description: product.description ?? undefined,
    image: Array.isArray(product.images) ? product.images : undefined,
    offers: {
      '@type': 'Offer',
      // R11-002 — Per Google `price` dell'offerta è il prezzo che il cliente paga ora: con la
      // promozione attiva quello scontato, al centesimo come in cassa. Prima si pubblicava il pieno.
      // La promozione non dice qui quando finisce, quindi niente `priceValidUntil`.
      price: (sconto > 0 ? discountedUnitCents(product.price, sconto) / 100 : Number(product.price)).toFixed(2),
      priceCurrency: 'EUR',
      availability: disponibilitaPerGoogle(product),
      url: `${env.appUrl()}/product/${product.id}`,
      seller: product.profiles?.store_name
        ? { '@type': 'LocalBusiness', name: product.profiles.store_name }
        : undefined,
    },
  };

  /**
   * 22/8/2026 — IL PRELOAD DELLA PRIMA FOTO NON SERVIVA A NIENTE.
   *
   * Nella pagina la prima immagine ha `priority`, e quella marcatura serve a
   * far scrivere a Next un preload nell'intestazione del documento. Ma la
   * pagina e' un componente client: quando il documento parte, quell'immagine
   * non esiste ancora — nasce dopo che il telefono ha scaricato il JavaScript,
   * l'ha eseguito e ha fatto la sua chiamata. Il preload arrivava a cose fatte,
   * cioe' non arrivava.
   *
   * Qui siamo nel guscio, che gira sul server: questa riga finisce nell'HTML
   * subito. Il telefono comincia a scaricare la foto del prodotto MENTRE
   * scarica il JavaScript, invece che dopo. E' la catena piu' lunga fra il
   * tocco sul link e la foto a schermo, ed e' la voce che pesa di piu'
   * sull'abbandono di un marketplace.
   *
   * L'indirizzo deve essere lo STESSO che chiedera' la pagina, altrimenti il
   * telefono scarica un secondo file invece di anticipare il primo — ed e'
   * esattamente quello che succedeva: qui c'era `sizedImage(..., 'detail')`,
   * cioe' 800 pixel, una misura che Next non chiede mai. La stessa foto
   * arrivava due volte. Adesso l'indirizzo lo costruisce `precaricoFoto`, con
   * lo stesso caricatore e lo stesso `sizes` dell'immagine in pagina.
   */
  const primaFoto =
    Array.isArray(product?.images) && product.images[0]
      ? precaricoFoto(sizedImage(product.images[0], 'detail'))
      : null;

  return (
    <>
      {primaFoto && (
        // Gli attributi si prendono TUTTI da `precaricoFoto`: sceglierne a mano
        // qualcuno, o riscriverne uno, e' come si era rotto la prima volta.
        <link rel="preload" as="image" {...primaFoto} fetchPriority="high" />
      )}
      {schema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(schema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
          }}
        />
      )}
      {/*
        30/8/2026 (R068) — IL PRODOTTO PARTE DENTRO LA PAGINA.

        La scheda e' un componente del browser di milleduecento righe: nome,
        prezzo e negozio li chiedeva DOPO aver scaricato ed eseguito il codice.
        Qui siamo sul server, e questa riga la lettura la fa adesso: quando il
        codice della pagina parte, la risposta e' gia' in mano e non si va in
        rete. La domanda e' la stessa che fa la pagina — vive in
        `lib/queries/catalogo.ts` — altrimenti il browser non la riconoscerebbe e
        rileggerebbe tutto lo stesso.

        15/10/2026 — Qui c'era scritto «la lettura non e' un viaggio in piu'».
        Non e' piu' vero: i viaggi li conta il commento in cima al componente.
        Il precarico porta anche «Venduto da» (R55): letto qui, sul server, il suo
        avviso sulla migrazione 126 finisce nei registri invece che sul telefono
        del cliente.
      */}
      <HydrationBoundary state={precarico}>{props.children}</HydrationBoundary>
    </>
  );
}

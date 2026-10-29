import type { Metadata } from 'next';
import { leggiProdottoPerMetadati, prodottoDaIndicizzare } from '@/lib/queries/metadati-vetrina';
import { sizedImage } from '@/lib/image-url';
import { precaricoFoto } from '@/lib/preload-foto';
import { HydrationBoundary } from '@tanstack/react-query';
import { precaricaProdotto } from '@/lib/queries/precarico';

export const revalidate = 300; // 5 min ISR sui metadata

// 27/8/2026 (R010) — vedi `lib/supabase/lettura-per-metadati.ts`: prima, con le variabili
// mancanti, questa pagina rispondeva «prodotto non trovato» senza dire niente a nessuno.
// 15/10/2026 (R3) — il negozio arriva dalla vista pubblica, non da `profiles`: chi legge
// questi metadati e' sempre un estraneo (Google, WhatsApp), e dopo la migrazione 161
// `profiles` per lui e' chiusa. Ogni scheda avrebbe preso «noindex».
const fetchProduct = (id: string) => leggiProdottoPerMetadati(id);

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const product = await fetchProduct(params.id);
  if (!product) {
    return { title: 'Prodotto non trovato · MyCity', robots: { index: false } };
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
  const [product, precarico] = await Promise.all([fetchProduct(params.id), precaricaProdotto(params.id)]);

  const schema = product && {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description ?? undefined,
    image: Array.isArray(product.images) ? product.images : undefined,
    offers: {
      '@type': 'Offer',
      price: Number(product.price).toFixed(2),
      priceCurrency: 'EUR',
      availability:
        product.status === 'available' && (product.stock ?? 0) > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
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
        // eslint-disable-next-line @next/next/no-head-element
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

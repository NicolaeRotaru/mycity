import type { Metadata } from 'next';
import { leggiPerMetadati } from '@/lib/supabase/lettura-per-metadati';
import { sizedImage } from '@/lib/image-url';

export const revalidate = 300; // 5 min ISR sui metadata

type ProductMeta = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  images: string[] | null;
  status: string;
  stock: number | null;
  profiles: { store_name: string | null; is_approved: boolean } | null;
};

// 27/8/2026 (R010) — vedi `lib/supabase/lettura-per-metadati.ts`: prima, con le variabili
// mancanti, questa pagina rispondeva «prodotto non trovato» senza dire niente a nessuno.
const fetchProduct = (id: string) =>
  leggiPerMetadati<ProductMeta>(
    'products',
    'id, name, description, price, images, status, stock, profiles!products_seller_id_fkey ( store_name, is_approved )',
    { id },
  );

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const product = await fetchProduct(params.id);
  if (!product) {
    return { title: 'Prodotto non trovato · MyCity', robots: { index: false } };
  }
  const storeName = product.profiles?.store_name ?? 'MyCity';
  const img = Array.isArray(product.images) && product.images[0] ? [product.images[0]] : undefined;
  const desc =
    (product.description ?? `${product.name} su MyCity. Acquisto da ${storeName}, consegna locale in 30-60 minuti.`).slice(0, 160);

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
    robots: product.status === 'available' && product.profiles?.is_approved
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
  const product = await fetchProduct(params.id);

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
   * L'indirizzo e' lo STESSO che chiedera' la pagina (`sizedImage(..., 'detail')`):
   * un preload di un indirizzo diverso scaricherebbe un secondo file invece di
   * anticipare il primo.
   */
  const primaFoto =
    Array.isArray(product?.images) && product.images[0]
      ? sizedImage(product.images[0], 'detail')
      : null;

  return (
    <>
      {primaFoto && (
        // eslint-disable-next-line @next/next/no-head-element
        <link rel="preload" as="image" href={primaFoto} fetchPriority="high" />
      )}
      {schema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(schema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
          }}
        />
      )}
      {props.children}
    </>
  );
}

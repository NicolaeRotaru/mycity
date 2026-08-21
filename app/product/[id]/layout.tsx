import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';

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

async function fetchProduct(id: string): Promise<ProductMeta | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase
      .from('products')
      .select(`
        id, name, description, price, images, status, stock,
        profiles!products_seller_id_fkey ( store_name, is_approved )
      `)
      .eq('id', id)
      .single();
    return (data as unknown as ProductMeta) ?? null;
  } catch {
    return null;
  }
}

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

  return (
    <>
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

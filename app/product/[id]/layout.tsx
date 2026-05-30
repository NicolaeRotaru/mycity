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
        id, name, description, price, images, status,
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
    (product.description ?? `${product.name} su MyCity. Acquisto da ${storeName}, consegna locale 24-48h.`).slice(0, 160);

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

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}

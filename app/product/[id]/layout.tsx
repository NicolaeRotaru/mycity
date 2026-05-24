import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 300; // 5 min ISR sui metadata

async function fetchProduct(id: string) {
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
    return data as any;
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: { id: string } },
): Promise<Metadata> {
  const product = await fetchProduct(params.id);
  if (!product) {
    return { title: 'Prodotto non trovato · MyCity', robots: { index: false } };
  }
  const storeName = product.profiles?.store_name ?? 'MyCity';
  const img = Array.isArray(product.images) && product.images[0] ? [product.images[0]] : undefined;
  const desc =
    (product.description ?? `${product.name} su MyCity. Acquisto da ${storeName}, consegna locale 24-48h.`).slice(0, 160);

  return {
    title: `${product.name} · ${storeName} · MyCity`,
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

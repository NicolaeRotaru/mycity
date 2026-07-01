import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';

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

async function fetchStore(id: string): Promise<StoreMeta | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase
      .from('seller_public_profiles')
      .select('id, store_name, store_description, store_logo, store_address, is_approved, role')
      .eq('id', id)
      .single();
    return (data as unknown as StoreMeta) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const store = await fetchStore(params.id);
  if (!store || store.role !== 'seller' || !store.is_approved) {
    return { title: 'Negozio non trovato · MyCity', robots: { index: false } };
  }
  const name = store.store_name ?? 'Negozio';
  const desc =
    (store.store_description ?? `Compra online da ${name} su MyCity. Consegna locale 24-48h o ritiro in negozio.`).slice(0, 160);
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

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return children;
}

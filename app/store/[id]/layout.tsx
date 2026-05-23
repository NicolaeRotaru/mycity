import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 300;

async function fetchStore(id: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase
      .from('profiles')
      .select('id, store_name, store_description, store_logo_url, store_address, is_approved, role')
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
  const store = await fetchStore(params.id);
  if (!store || store.role !== 'seller' || !store.is_approved) {
    return { title: 'Negozio non trovato · MyCity', robots: { index: false } };
  }
  const name = store.store_name ?? 'Negozio';
  const desc =
    (store.store_description ?? `Compra online da ${name} su MyCity. Consegna locale 24-48h o ritiro in negozio.`).slice(0, 160);
  const img = store.store_logo_url ? [store.store_logo_url] : undefined;

  return {
    title: `${name} · Negozio · MyCity`,
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

import type { Metadata } from 'next';
import { leggiPerMetadati } from '@/lib/supabase/lettura-per-metadati';
import { normalizeSite, pageBySlug } from '@/lib/store-site';

export const revalidate = 300;

type StoreMeta = {
  id: string;
  store_name: string | null;
  store_description: string | null;
  store_logo: string | null;
  is_approved: boolean;
  role: string | null;
  store_site: unknown;
};

// 27/8/2026 (R010) — vedi `lib/supabase/lettura-per-metadati.ts`: le variabili mancanti non
// diventano più un «non trovato» silenzioso.
const fetchStore = (id: string) =>
  leggiPerMetadati<StoreMeta>(
    'seller_public_profiles',
    'id, store_name, store_description, store_logo, is_approved, role, store_site',
    { id },
  );

export async function generateMetadata(props: { params: Promise<{ id: string; slug: string }> }): Promise<Metadata> {
  const { id, slug } = await props.params;
  const store = await fetchStore(id);
  const notFound: Metadata = { title: 'Pagina non trovata · MyCity', robots: { index: false } };
  if (!store || store.role !== 'seller' || !store.is_approved) return notFound;

  const site = normalizeSite(store.store_site);
  const page = pageBySlug(site, slug);
  if (!page || page.slug === '') return notFound;

  const name = store.store_name ?? 'Negozio';
  const title = (page.seo?.title || `${page.title} · ${name}`).slice(0, 70);
  const description = (page.seo?.description || store.store_description || `${page.title} — ${name} su MyCity.`).slice(0, 160);
  const noindex = page.visibility !== 'public' || page.seo?.noindex === true;
  const img = store.store_logo ? [store.store_logo] : undefined;

  return {
    title,
    description,
    robots: noindex ? { index: false } : undefined,
    openGraph: { title, description, type: 'website', siteName: 'MyCity', images: img },
    twitter: { card: 'summary', title, description, images: img },
    alternates: { canonical: `/store/${id}/${slug}` },
  };
}

export default function StoreSlugLayout({ children }: { children: React.ReactNode }) {
  return children;
}

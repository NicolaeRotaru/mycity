import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 600;

const CATEGORY_LONG_DESC: Record<string, string> = {
  alimentari: 'Alimentari freschi e tipici dei negozi di Piacenza. Consegna a casa in 24-48h o ritiro in negozio.',
  abbigliamento: 'Abbigliamento donna, uomo e bambino dei negozi di Piacenza. Compra online dai brand locali.',
  casa: 'Casa, arredamento e cucina dai negozi di Piacenza. Consegna locale rapida.',
  elettronica: 'Elettronica e accessori dai negozi di Piacenza. Garanzia e supporto locale.',
  libri: 'Libri, fumetti e cartoleria dei negozi di Piacenza.',
  giardino: 'Piante, semi e attrezzi per il giardino dai negozi di Piacenza.',
  bellezza: 'Bellezza, cosmesi e benessere dai negozi di Piacenza.',
  sport: 'Sport, fitness e tempo libero dai negozi di Piacenza.',
};

type CategoryMeta = { slug: string; name: string };

async function fetchCategory(slug: string): Promise<CategoryMeta | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase
      .from('categories')
      .select('slug, name')
      .eq('slug', slug)
      .single();
    return (data as CategoryMeta) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: { slug: string } },
): Promise<Metadata> {
  const cat = await fetchCategory(params.slug);
  if (!cat) {
    return { title: 'Categoria non trovata · MyCity', robots: { index: false } };
  }
  const name = cat.name;
  const desc = CATEGORY_LONG_DESC[params.slug] ?? `Acquista ${name.toLowerCase()} dai negozi di Piacenza su MyCity. Consegna 24-48h.`;
  return {
    title: `${name} a Piacenza — Compra online dai negozi locali · MyCity`,
    description: desc,
    openGraph: {
      title: `${name} a Piacenza`,
      description: desc,
      type: 'website',
      siteName: 'MyCity',
    },
    alternates: { canonical: `/category/${params.slug}` },
  };
}

export default function CategoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}

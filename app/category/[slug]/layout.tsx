import type { Metadata } from 'next';
import { leggiPerMetadati } from '@/lib/supabase/lettura-per-metadati';

export const revalidate = 600;

const CATEGORY_LONG_DESC: Record<string, string> = {
  alimentari: 'Alimentari freschi e tipici dei negozi di Piacenza. Consegna a casa in 30-60 minuti o ritiro in negozio.',
  abbigliamento: 'Abbigliamento donna, uomo e bambino dei negozi di Piacenza. Compra online dai brand locali.',
  casa: 'Casa, arredamento e cucina dai negozi di Piacenza. Consegna locale rapida.',
  elettronica: 'Elettronica e accessori dai negozi di Piacenza. Garanzia e supporto locale.',
  libri: 'Libri, fumetti e cartoleria dei negozi di Piacenza.',
  giardino: 'Piante, semi e attrezzi per il giardino dai negozi di Piacenza.',
  bellezza: 'Bellezza, cosmesi e benessere dai negozi di Piacenza.',
  sport: 'Sport, fitness e tempo libero dai negozi di Piacenza.',
};

type CategoryMeta = { slug: string; name: string };

// 27/8/2026 (R010) — vedi `lib/supabase/lettura-per-metadati.ts`.
const fetchCategory = (slug: string) =>
  leggiPerMetadati<CategoryMeta>('categories', 'slug, name', { slug });

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const cat = await fetchCategory(params.slug);
  if (!cat) {
    return { title: 'Categoria non trovata · MyCity', robots: { index: false } };
  }
  const name = cat.name;
  const desc = CATEGORY_LONG_DESC[params.slug] ?? `Acquista ${name.toLowerCase()} dai negozi di Piacenza su MyCity. Consegna in 30-60 minuti.`;
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

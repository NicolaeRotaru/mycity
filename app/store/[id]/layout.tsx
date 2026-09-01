import type { Metadata } from 'next';
import { leggiPerMetadati } from '@/lib/supabase/lettura-per-metadati';

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

/**
 * 27/8/2026 (R010) — qui si leggevano le variabili di Supabase a mano e, se mancavano, si tornava
 * `null` in silenzio: Google riceveva «Negozio non trovato» con noindex su una scheda vera, senza
 * un errore da nessuna parte. Adesso la lettura passa da `lib/supabase/lettura-per-metadati.ts`,
 * che con le variabili mancanti si ferma e dice quali.
 */
const fetchStore = (id: string) =>
  leggiPerMetadati<StoreMeta>(
    'seller_public_profiles',
    'id, store_name, store_description, store_logo, store_address, is_approved, role',
    { id },
  );

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const store = await fetchStore(params.id);
  if (!store || store.role !== 'seller' || !store.is_approved) {
    return { title: 'Negozio non trovato · MyCity', robots: { index: false } };
  }
  const name = store.store_name ?? 'Negozio';
  const desc =
    (store.store_description ?? `Compra online da ${name} su MyCity. Consegna locale in 30-60 minuti o ritiro in negozio.`).slice(0, 160);
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

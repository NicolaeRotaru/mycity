import type { Metadata } from 'next';
import { leggiPerMetadati } from '@/lib/supabase/lettura-per-metadati';
import { normalizeSite, pageBySlug } from '@/lib/store-site';
import { notFound } from 'next/navigation';

/**
 * 28/11/2026 (R04-013) — NESSUNA CACHE DICHIARATA CHE NON C'È.
 * Qui c'era `revalidate = 300`, ma `dynamic = 'force-dynamic'` in app/layout.tsx (la parola
 * d'ordine degli script, vedi lì) costruisce ogni pagina a ogni visita: la cache dichiarata non
 * contava, e chi leggeva credeva che la pagina su misura del negozio arrivasse da una copia. E il giorno in cui quella riga
 * verrà tolta, una copia di 300 secondi mostrerebbe il contenuto di cinque minuti prima (oggi vince già lo 0 della vetrina sopra). Con 0 la dichiarazione dice il
 * vero oggi e regge domani, come la vetrina (app/store/[id]/layout.tsx, R10-004). Una cache vera
 * delle letture, come quella della home (unstable_cache), è una scelta di Nicola: quanto vecchio
 * può essere la pagina su misura del negozio che il cliente vede.
 */
export const revalidate = 0;

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
  // 17/11/2026 — Il titolo usa parole diverse dall'h1 della pagina («Pagina non trovata»), come la
  // 404 (`app/not-found.tsx`): Next manda i metadati in streaming dentro il corpo, e con le stesse
  // parole la scritta compariva due volte, nella scheda e nella pagina.
  const notFound: Metadata = { title: 'Pagina del negozio non trovata · MyCity', robots: { index: false }, alternates: { canonical: null } };
  // R10-002 — La stessa condizione con cui il guscio (app/store/[id]/layout.tsx) risponde 404: anche il nome vuoto.
  if (!store || store.role !== 'seller' || !store.is_approved || !store.store_name) return notFound;

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
    // Mai `robots: undefined`: in Next 15.5 cancellerebbe il noindex ereditato dal genitore.
    ...(noindex ? { robots: { index: false } } : {}),
    openGraph: { title, description, type: 'website', siteName: 'MyCity', images: img },
    twitter: { card: 'summary', title, description, images: img },
    alternates: { canonical: `/store/${id}/${slug}` },
  };
}

/**
 * R10-001 — Una pagina su misura che non c'è dice «non trovata» dal server, con la stessa regola
 * della pagina (`pageBySlug`, e la pagina nascosta resta aperta col link). Il negozio che non c'è lo
 * ferma già il guscio sopra (app/store/[id]/layout.tsx). Un guasto non è «non trovato».
 */
export default async function StoreSlugLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ id: string; slug: string }> },
) {
  const { id, slug } = await params;
  const store = await fetchStore(id).catch(() => undefined);
  if (store !== undefined) {
    const page = store ? pageBySlug(normalizeSite(store.store_site), slug) : undefined;
    if (!page || page.slug === '') notFound();
  }
  return children;
}

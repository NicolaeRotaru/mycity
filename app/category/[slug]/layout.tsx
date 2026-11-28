import { CONSEGNA_ALL_ORA_CHE_SCEGLI } from '@/lib/promessa-consegna';
import type { Metadata } from 'next';
import { leggiPerMetadati } from '@/lib/supabase/lettura-per-metadati';
import { fraseComeArriva } from '@/lib/promesse-pubbliche';
import { FINO_AL_CONFINE } from '@/lib/ordini/zona-di-consegna';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { logger } from '@/lib/logger';
import { notFound } from 'next/navigation';

/**
 * 28/11/2026 (R04-013) — NESSUNA CACHE DICHIARATA CHE NON C'È.
 * Qui c'era `revalidate = 600`, ma `dynamic = 'force-dynamic'` in app/layout.tsx (la parola
 * d'ordine degli script, vedi lì) costruisce ogni pagina a ogni visita: la cache dichiarata non
 * contava, e chi leggeva credeva che la pagina della categoria arrivasse da una copia. E il giorno in cui quella riga
 * verrà tolta, una copia di 600 secondi mostrerebbe prodotti e prezzi di dieci minuti prima, e una categoria appena creata ancora «non trovata». Con 0 la dichiarazione dice il
 * vero oggi e regge domani, come la vetrina (app/store/[id]/layout.tsx, R10-004). Una cache vera
 * delle letture, come quella della home (unstable_cache), è una scelta di Nicola: quanto vecchio
 * può essere la pagina della categoria che il cliente vede.
 */
export const revalidate = 0;

const CATEGORY_LONG_DESC: Record<string, string> = {
  // 3/9/2026 — Prometteva «o ritiro in negozio», che alla cassa non c'e': la frase nasce
  // dall'interruttore in lib/promesse-pubbliche.ts, i minuti dal numero deciso in lib/delivery.ts.
  // R12-009 — Col ritiro acceso la frase si allunga: il prefisso si accorcia per stare nei 160 caratteri.
  alimentari: `Alimentari tipici piacentini. ${fraseComeArriva()}`,
  abbigliamento: 'Abbigliamento donna, uomo e bambino dei negozi di Piacenza. Compra online dai brand locali.',
  // 27/10/2026 (terzo giro) — Qui c’era una consegna promessa «rapida», senza confine né tempo.
  casa: `Casa, arredamento e cucina dai negozi di Piacenza, consegnati ${FINO_AL_CONFINE}.`,
  elettronica: 'Elettronica e accessori dai negozi di Piacenza. Garanzia e supporto locale.',
  libri: 'Libri, fumetti e cartoleria dei negozi di Piacenza.',
  giardino: 'Piante, semi e attrezzi per il giardino dai negozi di Piacenza.',
  bellezza: 'Bellezza, cosmesi e benessere dai negozi di Piacenza.',
  sport: 'Sport, fitness e tempo libero dai negozi di Piacenza.',
};

type CategoryMeta = { id: string; slug: string; name: string; parent_id?: string | null };

// 27/8/2026 (R010) — vedi `lib/supabase/lettura-per-metadati.ts`.
const fetchCategory = (slug: string) =>
  leggiPerMetadati<CategoryMeta>('categories', 'id, slug, name, parent_id', { slug });

/**
 * 1/11/2026 — UNA CATEGORIA VUOTA NON SI MANDA A GOOGLE.
 *
 * Delle 72 categorie solo 3 avevano un prodotto: le altre erano pagine vuote che Google poteva
 * indicizzare. La mappa del sito già le toglie (`app/sitemap.ts`); qui la pagina stessa dice
 * «non indicizzarmi» finché dentro — o in una sua sottocategoria — non c'è almeno un prodotto
 * disponibile. Risponde `null` quando non lo sa (lettura fallita): allora la pagina resta
 * indicizzabile come prima, perché un errore di rete non deve togliere da Google le categorie vere.
 */
async function haProdotti(idCategoria: string): Promise<boolean | null> {
  try {
    const supa = creaClientAnonimo();
    const cat = await supa.from('categories').select('id, parent_id');
    if (cat.error) throw cat.error;
    const figlieDi = new Map<string, string[]>();
    for (const c of (cat.data ?? []) as { id: string; parent_id: string | null }[]) {
      if (!c.parent_id) continue;
      figlieDi.set(c.parent_id, [...(figlieDi.get(c.parent_id) ?? []), c.id]);
    }
    const ids = new Set<string>([idCategoria]);
    const daVedere = [idCategoria];
    while (daVedere.length > 0 && ids.size < 500) {
      for (const f of figlieDi.get(daVedere.pop() as string) ?? []) {
        if (!ids.has(f)) { ids.add(f); daVedere.push(f); }
      }
    }
    const prod = await supa.from('products').select('id').eq('status', 'available').in('category_id', [...ids]).limit(1);
    if (prod.error) throw prod.error;
    return (prod.data ?? []).length > 0;
  } catch (e) {
    logger.warn('[categoria] non so se la categoria ha prodotti: resta indicizzabile', { idCategoria, e });
    return null;
  }
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const cat = await fetchCategory(params.slug);
  if (!cat) {
    return { title: 'Categoria non trovata · MyCity', robots: { index: false }, alternates: { canonical: null } };
  }
  const name = cat.name;
  const vuota = cat.id ? (await haProdotti(cat.id)) === false : false;
  // 5/11/2026 — Il ripiego scriveva «Acquista bambini…», «Acquista uomo…»: il nome
  // di una sottocategoria messo in minuscolo dopo un verbo. Adesso il nome resta
  // un nome, preceduto da quello della madre quando c'è («Abbigliamento · Bambini»).
  const madre = CATEGORY_LONG_DESC[params.slug] || !cat.parent_id
    ? null
    : await leggiPerMetadati<{ name: string }>('categories', 'name', { id: cat.parent_id });
  const nomeIntero = madre?.name ? `${madre.name} · ${name}` : name;
  const desc = CATEGORY_LONG_DESC[params.slug] ?? `${nomeIntero} dai negozi di Piacenza su MyCity. ${CONSEGNA_ALL_ORA_CHE_SCEGLI}.`;
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
    ...(vuota ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * R10-001 — Una categoria che non esiste: qui, nel guscio, si decide la 404. La pagina è del
 * browser, e il suo «notFound()» arrivava dopo la risposta già partita con «tutto ok». La 404 arriva
 * in rete solo togliendo app/loading.tsx, che oggi c'è ancora e fa partire la risposta con 200. La riga è la stessa dei metadati (una lettura
 * sola); un guasto non è «non trovato», e la pagina resta quella di prima col suo «Riprova».
 */
export default async function CategoryLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const cat = await fetchCategory(slug).catch(() => undefined);
  if (cat === null) notFound();
  return children;
}

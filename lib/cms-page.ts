import { z } from 'zod';
import { homeSectionSchema, type HomeSection, MAX_HOME_SECTIONS } from './home-site';

/**
 * Pagine statiche editabili (cms_pages, migration 077) come blocchi di CONTENUTO,
 * riusando lo stesso modello della home (lib/home-site.ts). Solo i tipi di contenuto
 * (testo/banner/galleria/video) sono ammessi: niente blocchi strutturali del
 * marketplace dentro una pagina informativa.
 */

export const CMS_CONTENT_TYPES = ['richText', 'banner', 'gallery', 'video'] as const;

/** Pagine note gestibili dall'admin (lo slug mappa la rotta pubblica). */
export const CMS_PAGES: { slug: string; label: string; route: string }[] = [
  { slug: 'about', label: 'Chi siamo', route: '/about' },
  { slug: 'terms', label: 'Termini di servizio', route: '/terms' },
  { slug: 'privacy', label: 'Privacy', route: '/privacy' },
  { slug: 'faq', label: 'FAQ', route: '/faq' },
];

export function cmsPageLabel(slug: string): string {
  return CMS_PAGES.find((p) => p.slug === slug)?.label ?? slug;
}

const contentSet = new Set<string>(CMS_CONTENT_TYPES);

export const cmsPageSchema = z.object({
  title: z.string().trim().max(80).default(''),
  status: z.enum(['draft', 'published']).default('draft'),
  sections: z
    .array(homeSectionSchema)
    .max(MAX_HOME_SECTIONS)
    .refine((arr) => arr.every((s) => contentSet.has(s.type)), 'Solo blocchi di contenuto sono ammessi'),
});
export type CmsPage = z.infer<typeof cmsPageSchema>;
export type CmsSection = HomeSection;

export function emptyCmsPage(title = ''): CmsPage {
  return { title, status: 'draft', sections: [] };
}

/** Un blocco salvato che non passa più lo schema: si toglie, ma si dice quale. */
export type BloccoScartato = { posizione: number; type: string | null; motivo: string };

/**
 * Legge una riga DB { title, sections, status } blocco per blocco, come
 * `leggiHomeSite`: un solo blocco non più valido non butta via tutta la pagina.
 * Prima un blocco rotto faceva tornare la pagina vuota, e il primo salvataggio
 * dell'editor cancellava anche i blocchi buoni.
 */
export function leggiCmsPage(
  raw: { title?: unknown; sections?: unknown; status?: unknown } | null | undefined,
): { page: CmsPage; scartati: BloccoScartato[] } | null {
  if (!raw) return null;
  const grezzi = Array.isArray(raw.sections) ? raw.sections : [];
  const sections: CmsSection[] = [];
  const scartati: BloccoScartato[] = [];
  grezzi.forEach((el: unknown, posizione: number) => {
    const tipo = el && typeof el === 'object' ? (el as Record<string, unknown>).type : undefined;
    const type = typeof tipo === 'string' ? tipo : null;
    const letto = homeSectionSchema.safeParse(el);
    if (!letto.success) {
      scartati.push({ posizione, type, motivo: letto.error.issues[0]?.message ?? 'blocco non valido' });
    } else if (!contentSet.has(letto.data.type)) {
      scartati.push({ posizione, type, motivo: 'non è un blocco di contenuto' });
    } else if (sections.length >= MAX_HOME_SECTIONS) {
      scartati.push({ posizione, type, motivo: `oltre il massimo di ${MAX_HOME_SECTIONS} blocchi` });
    } else {
      sections.push(letto.data);
    }
  });
  const testa = cmsPageSchema.safeParse({
    title: typeof raw.title === 'string' ? raw.title : '',
    status: raw.status,
    sections,
  });
  if (!testa.success) {
    // Titolo o stato rovinati: si tengono i blocchi buoni in bozza.
    return { page: { title: '', status: 'draft', sections }, scartati };
  }
  return { page: testa.data, scartati };
}

/** Normalizza una riga DB { title, sections, status } a CmsPage; null se assente. Tiene i blocchi validi. */
export function normalizeCmsPage(
  raw: { title?: unknown; sections?: unknown; status?: unknown } | null | undefined,
): CmsPage | null {
  return leggiCmsPage(raw)?.page ?? null;
}

/** Sezioni effettivamente da renderizzare (solo attive). */
export function cmsEnabledSections(page: CmsPage): CmsSection[] {
  return page.sections.filter((s) => s.enabled);
}

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

/** Normalizza una riga DB { title, sections, status } a CmsPage; null se assente/non valida. */
export function normalizeCmsPage(
  raw: { title?: unknown; sections?: unknown; status?: unknown } | null | undefined,
): CmsPage | null {
  if (!raw) return null;
  const parsed = cmsPageSchema.safeParse({
    title: typeof raw.title === 'string' ? raw.title : '',
    status: raw.status,
    sections: Array.isArray(raw.sections) ? raw.sections : [],
  });
  return parsed.success ? parsed.data : null;
}

/** Sezioni effettivamente da renderizzare (solo attive). */
export function cmsEnabledSections(page: CmsPage): CmsSection[] {
  return page.sections.filter((s) => s.enabled);
}

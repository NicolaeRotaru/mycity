import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { cmsPageSchema, emptyCmsPage, leggiCmsPage, CMS_PAGES, type CmsPage } from '@/lib/cms-page';
import { writeAudit } from '@/lib/audit';
import { siteByteSize, MAX_SITE_BYTES } from '@/lib/home-site';
import { sanitizeRichText } from '@/lib/sanitize-html';

export const runtime = 'nodejs';

/**
 * GET/PUT /api/admin/cms/[slug]
 * Pagina statica editabile (cms_pages). Solo admin; validazione cmsPageSchema;
 * sanitizzazione richText; guard dimensione; scrittura via service-role.
 */

function sanitizeCms(page: CmsPage): CmsPage {
  return {
    ...page,
    sections: page.sections.map((s) =>
      s.type === 'richText' ? { ...s, config: { ...s.config, body: sanitizeRichText(s.config.body) } } : s,
    ),
  };
}

export const GET = withAdminAuth(async ({ params }) => {
    const slug = String(params.slug);
    const admin = getAdminSupabase();
    const { data, error } = await admin.from('cms_pages').select('title, sections, status').eq('slug', slug).maybeSingle();
    if (error) return ApiErrors.internal('Impossibile caricare la pagina');
    // Blocco per blocco: un blocco non più valido si toglie e si segnala,
    // il resto della pagina resta (prima tornava tutta vuota).
    const letta = leggiCmsPage(data as { title?: unknown; sections?: unknown; status?: unknown } | null);
    return apiSuccess({ page: letta?.page ?? emptyCmsPage(), scartati: letta?.scartati ?? [] });
});

export const PUT = withAdminAuth(async ({ user, req: r, params }) => {
    const slug = String(params.slug);
    // Si pubblica solo una pagina che il sito legge davvero dal pannello.
    if (!CMS_PAGES.some((p) => p.slug === slug)) {
      return ApiErrors.invalidRequest('Questa pagina non si modifica dal pannello: il sito non legge i suoi contenuti da qui.');
    }
    let body: unknown;
    try { body = await r.json(); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
    const raw = (body as { page?: unknown })?.page ?? body;

    const parsed = cmsPageSchema.safeParse(raw);
    if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Pagina non valida');

    const page = sanitizeCms(parsed.data);
    if (siteByteSize(page) > MAX_SITE_BYTES) {
      return ApiErrors.payloadTooLarge('La pagina è troppo grande. Riduci testi, immagini o blocchi.');
    }

    const admin = getAdminSupabase();
    const { error } = await admin.from('cms_pages').upsert({
      slug,
      title: page.title,
      sections: page.sections,
      status: page.status,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });
    if (error) return ApiErrors.internal('Impossibile salvare la pagina');

    await writeAudit({ actorId: user.id, action: 'cms.update', targetTable: 'cms_pages', targetId: slug, metadata: { status: page.status, blocchi: page.sections.length } });
    return apiSuccess({ page });
});

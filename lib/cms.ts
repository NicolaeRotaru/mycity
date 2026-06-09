import { getServerSupabase } from '@/lib/supabase/server';
import { normalizeCmsPage, type CmsPage } from '@/lib/cms-page';

/**
 * Carica una pagina CMS pubblicata (server-side, SELECT pubblica via RLS su
 * status='published'). Ritorna null se assente/non pubblicata o se la tabella non
 * esiste ancora (migration 077 non applicata) → la pagina pubblica fa fallback al
 * contenuto hardcoded.
 */
export async function loadPublishedCmsPage(slug: string): Promise<CmsPage | null> {
  try {
    const supa = await getServerSupabase();
    const { data } = await supa
      .from('cms_pages')
      .select('title, sections, status')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    const page = normalizeCmsPage(data as { title?: unknown; sections?: unknown; status?: unknown } | null);
    // Una pagina pubblicata ma senza blocchi non deve oscurare il fallback hardcoded.
    return page && page.sections.length > 0 ? page : null;
  } catch {
    return null;
  }
}

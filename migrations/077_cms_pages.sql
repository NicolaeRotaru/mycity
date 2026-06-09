-- 077 — Pagine statiche editabili dall'admin (cms_pages)
--
-- Tabella per le pagine informative (Chi siamo, Termini, Privacy, FAQ, …) componibili
-- a blocchi di contenuto (testo/banner/galleria/video), sullo stesso modello della
-- home (lib/home-site.ts → blocchi di contenuto). Forma di `sections` validata in app
-- (lib/cms-page.ts + zod) e testo ricco sanitizzato lato API.
--
-- Sicurezza: SELECT pubblica solo per le pagine pubblicate (status='published'); la
-- scrittura non ha policy → passa dall'API admin (withAdminAuth + service-role).
--
-- Retro-compatibilità: nessuna riga = pagina non personalizzata. In app la pagina
-- pubblica fa fallback al contenuto hardcoded attuale (zero regressioni: il testo
-- legale resta invariato finché l'admin non crea/pubblica una versione propria).
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.cms_pages (
    slug       text PRIMARY KEY,
    title      text NOT NULL DEFAULT '',
    sections   jsonb NOT NULL DEFAULT '[]'::jsonb,
    status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.cms_pages IS
  'Pagine statiche editabili (Chi siamo, Termini, Privacy, FAQ, …) come blocchi di contenuto. Forma validata in app (lib/cms-page.ts). SELECT pubblica solo se status=published; scrittura via API admin service-role.';

ALTER TABLE public.cms_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cms_pages_public_read ON public.cms_pages;
CREATE POLICY cms_pages_public_read ON public.cms_pages
    FOR SELECT USING (status = 'published');

NOTIFY pgrst, 'reload schema';

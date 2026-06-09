-- 075 — Impostazioni globali del marketplace (site_settings)
--
-- Tabella SINGLETON (una sola riga, id=1) che raccoglie i contenuti globali del
-- marketplace gestiti dall'admin, sul modello di store_site (072) ma a livello di
-- piattaforma anziché di singolo negozio:
--   * home_site  → la HOME pubblica come lista ordinata di SEZIONI (logica "Shopify":
--                  l'admin riordina/nasconde/aggiunge blocchi). Forma validata in app
--                  via lib/home-site.ts + zod.
--   * branding   → barra annunci, wordmark, accent, footer. Forma validata in app via
--                  lib/site-branding.ts (Fase 2).
--
-- Scelta single-row + JSONB (vs molte colonne/tabelle): la home si legge con UNA
-- SELECT, niente join/N+1; un solo entry nei tipi generati; evolvibile senza nuove
-- migration. La validazione di forma + i limiti anti-abuso vivono in app, come per
-- store_site (072) e store_customization (052).
--
-- Sicurezza: SELECT pubblica (la home è pubblica). NESSUNA policy di write: le
-- scritture passano solo dall'API admin (withAdminAuth) via service-role client
-- (getAdminSupabase), esattamente come /api/seller/site. La RLS resta backstop.
--
-- Retro-compatibilità: default '{}' => in app `normalizeHomeSite` deriva una HOME di
-- default che riproduce ESATTAMENTE il layout fisso attuale di app/page.tsx. Quindi la
-- home rende identica finché l'admin non salva una configurazione propria.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.site_settings (
    id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    home_site  jsonb NOT NULL DEFAULT '{}'::jsonb,
    branding   jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.site_settings IS
  'Impostazioni globali del marketplace (riga singola id=1): home_site (home a blocchi) e branding. Forma validata in app (lib/home-site.ts, lib/site-branding.ts). Scrittura solo via API admin service-role.';

-- Riga singleton sempre presente (così la SELECT pubblica trova sempre la config).
INSERT INTO public.site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_settings_public_read ON public.site_settings;
CREATE POLICY site_settings_public_read ON public.site_settings
    FOR SELECT USING (true);

NOTIFY pgrst, 'reload schema';

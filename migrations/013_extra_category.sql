-- 013: aggiunge una 9a categoria principale (Giocattoli)
-- Cosi' la griglia categorie in homepage e' un 3x3 perfetto.
-- Idempotente.

INSERT INTO public.categories (slug, name, icon)
VALUES ('giocattoli', 'Giocattoli', '🧸')
ON CONFLICT (slug) DO NOTHING;

NOTIFY pgrst, 'reload schema';

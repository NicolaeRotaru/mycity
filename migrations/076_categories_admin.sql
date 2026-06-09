-- 076 — Gestione categorie dall'admin (sort_order + featured)
--
-- Aggiunge due colonne a `categories` per il pannello admin /admin/categories:
--   * sort_order → ordine di visualizzazione (in home e nei menu); più basso = prima.
--   * featured   → categoria "in evidenza" (mostrata per prima nella vetrina home).
--
-- Additiva e idempotente. La scrittura su categories avviene via API admin
-- (withAdminAuth + service-role); la SELECT resta pubblica (policy esistente
-- "Anyone can view categories"). Nessun dato esistente modificato (default 0/false
-- => stesso ordinamento per-nome di prima finché l'admin non riordina).

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS featured   boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS categories_sort_idx ON public.categories(parent_id, sort_order);

NOTIFY pgrst, 'reload schema';

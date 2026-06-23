-- 104_invoice_sequence_per_year.sql
-- Audit 🟠-21: numerazione fattura non a norma. invoice_sequences aveva PK solo
-- su seller_id: al cambio anno il contatore dell'anno precedente veniva
-- sovrascritto (last_number=1), perdendo la progressione. Una numerazione
-- fattura deve essere progressiva e per-anno, e ogni anno deve restare
-- ricostruibile. Fix: PK (seller_id, year) — una riga immutabile per anno.
-- La RPC next_invoice_number non è ancora usata (SDI non implementato, vedi
-- 🔴-2): questa è una correzione preparatoria, da avere PRIMA della prima
-- emissione. Idempotente.

-- 1) Chiave composta (seller_id, year). La tabella è di fatto vuota (la RPC non
-- è mai stata chiamata), quindi il cambio di PK è sicuro.
ALTER TABLE public.invoice_sequences DROP CONSTRAINT IF EXISTS invoice_sequences_pkey;
ALTER TABLE public.invoice_sequences
  ADD CONSTRAINT invoice_sequences_pkey PRIMARY KEY (seller_id, year);

-- 2) Allocazione atomica per (seller_id, year): upsert con incremento, mai
-- overwrite del contatore di un altro anno. search_path fissato (hardening).
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_seller uuid, p_year int)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.invoice_sequences (seller_id, year, last_number)
    VALUES (p_seller, p_year, 1)
    ON CONFLICT (seller_id, year)
    DO UPDATE SET last_number = public.invoice_sequences.last_number + 1,
                  updated_at = now()
    RETURNING last_number INTO v_n;

  RETURN p_year::text || '/' || lpad(v_n::text, 6, '0');
END$$;

REVOKE ALL ON FUNCTION public.next_invoice_number(uuid, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid, int) TO service_role;

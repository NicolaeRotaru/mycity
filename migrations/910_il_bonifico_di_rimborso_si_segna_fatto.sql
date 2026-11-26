-- 910 — Il bonifico di rimborso al cliente si segna «fatto», una volta sola (26/11/2026).
--
-- Il difetto. Chi ha pagato in contanti riavrà i soldi con un bonifico, che fa a mano chi
-- amministra MyCity. `refundOrder` scrive il segno `bonifico:<centesimi>:<chiave>` in
-- orders.stripe_refund_id e manda a ogni amministratore un avviso nella campanella. Poi niente:
-- nessuno stato da fare / fatto / respinto, nessuna pagina che li elenca. Contro il doppio
-- pagamento c'era solo «cerca questa causale nei movimenti del conto: se c'è, è già pagato», e un
-- bonifico respinto dalla banca, con la causale rimasta fra i movimenti, risultava pagato.
--
-- La regola di Nicola (registro dei fatti, pagamenti.rimborso-contanti, 29/10/2026): il bonifico
-- al cliente lo fa Nicola dall'app della banca, «poi tocca "fatto"».
--
-- COSA FA.
--  1. private.bonifici_rimborso — l'esito di ogni bonifico, uno per chiave (`return_<id>`,
--     `dispute_<id>`, …): FATTO o RESPINTO, chi e quando, la cifra e l'ordine. I bonifici DA FARE
--     restano quelli che il segno sull'ordine già dice: refundOrder non cambia. Sta nello schema
--     `private`, che l'API del sito non espone: nessuno la legge o la scrive direttamente, si passa
--     dalle due funzioni qui sotto. RLS accesa e nessuna regola: chiusa anche se un giorno lo schema
--     venisse esposto. Nessun IBAN (vedi tests/sql/rls/40) e nessun legame con profiles: «chi» è
--     l'id dell'amministratore, il nome si legge quando serve.
--  2. public.admin_bonifici_rimborso() — l'elenco dei bonifici scritti sugli ordini, ognuno col suo
--     esito, il cliente (nome ed email, da dove accettare l'IBAN) e, per i resi, quando il reso è
--     stato chiesto (da lì contano i 14 giorni). Solo un amministratore, o il server (l'allarme del
--     termine in operational-alerts).
--  3. public.admin_segna_bonifico_rimborso(ordine, chiave, centesimi, esito) — solo un
--     amministratore. Chiave e centesimi devono essere quelli di un segno sull'ordine.
--       · FATTO: passa solo se non è già FATTO. Due amministratori insieme: il secondo riceve
--         GIA_FATTO con chi e quando, e la riga resta del primo (niente doppio bonifico).
--       · RESPINTO (dalla banca): solo su un FATTO; il bonifico torna fra quelli da fare.
--     Ogni passo lascia una riga in audit_logs (senza nomi).
--
-- Prova: tests/sql/rls/riparazione-r05-bonifici-rimborso.test.sql.
-- Si può rieseguire. NON si applica a mano: lo decide Nicola.
-- REVERSIBILE:
--   DROP FUNCTION IF EXISTS public.admin_segna_bonifico_rimborso(uuid, text, integer, text);
--   DROP FUNCTION IF EXISTS public.admin_bonifici_rimborso();
--   DROP TABLE IF EXISTS private.bonifici_rimborso;

BEGIN;

-- 1) L'esito dei bonifici ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.bonifici_rimborso (
  chiave text PRIMARY KEY CHECK (char_length(chiave) BETWEEN 1 AND 200),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  centesimi integer NOT NULL CHECK (centesimi > 0),
  stato text NOT NULL CHECK (stato IN ('FATTO', 'RESPINTO')),
  fatto_da uuid,
  fatto_il timestamptz,
  respinto_da uuid,
  respinto_il timestamptz,
  CONSTRAINT bonifici_rimborso_fatto_ha_il_giorno CHECK (stato <> 'FATTO' OR fatto_il IS NOT NULL),
  CONSTRAINT bonifici_rimborso_respinto_ha_il_giorno CHECK (stato <> 'RESPINTO' OR respinto_il IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS bonifici_rimborso_order_idx ON private.bonifici_rimborso (order_id);

ALTER TABLE private.bonifici_rimborso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.bonifici_rimborso FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE private.bonifici_rimborso IS
  'L esito dei bonifici di rimborso fatti a mano (ordini in contanti): FATTO o RESPINTO dalla banca, uno per chiave. Si legge e si scrive solo con admin_bonifici_rimborso e admin_segna_bonifico_rimborso (migrazione 910).';

-- 2) L'elenco ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_bonifici_rimborso()
RETURNS TABLE (
  order_id uuid,
  chiave text,
  centesimi integer,
  cliente_nome text,
  cliente_email text,
  chiesto_il timestamptz,
  stato text,
  fatto_da_nome text,
  fatto_il timestamptz,
  respinto_da_nome text,
  respinto_il timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role') THEN
    RAISE EXCEPTION 'bonifici di rimborso: riservato agli amministratori' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT o.id,
           m[2],
           m[1]::int,
           coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(o.delivery_full_name), '')),
           u.email::text,
           r.created_at,
           coalesce(b.stato, 'DA_FARE'),
           pf.full_name,
           b.fatto_il,
           pr.full_name,
           b.respinto_il
      FROM public.orders o
      CROSS JOIN LATERAL regexp_split_to_table(o.stripe_refund_id, ',') AS s(segno)
      CROSS JOIN LATERAL regexp_match(btrim(s.segno), '^bonifico:([0-9]+):(.+)$') AS m
      LEFT JOIN private.bonifici_rimborso b ON b.chiave = m[2] AND b.order_id = o.id
      LEFT JOIN public.returns r ON m[2] = 'return_' || r.id::text AND r.order_id = o.id
      LEFT JOIN public.profiles p ON p.id = o.user_id
      LEFT JOIN auth.users u ON u.id = o.user_id
      LEFT JOIN public.profiles pf ON pf.id = b.fatto_da
      LEFT JOIN public.profiles pr ON pr.id = b.respinto_da
     WHERE o.stripe_refund_id LIKE '%bonifico:%'
       AND length(m[1]) <= 9;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_bonifici_rimborso() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_bonifici_rimborso() FROM anon;
-- Il controllo vero è dentro: la pagina la chiama con la sessione dell'amministratore.
GRANT EXECUTE ON FUNCTION public.admin_bonifici_rimborso() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_bonifici_rimborso() IS
  'I bonifici di rimborso scritti sugli ordini (segno bonifico:<centesimi>:<chiave>), con l esito (DA_FARE, FATTO, RESPINTO), il cliente e per i resi il giorno della richiesta. Solo amministratori o il server (migrazione 910).';

-- 3) Fatto / respinto dalla banca -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_segna_bonifico_rimborso(
  p_order_id uuid,
  p_chiave text,
  p_centesimi integer,
  p_esito text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_chi uuid := (SELECT auth.uid());
  v_elenco text;
  v_trovato boolean;
  v_preso text;
  b private.bonifici_rimborso%ROWTYPE;
BEGIN
  IF NOT public.is_admin() OR v_chi IS NULL THEN
    RAISE EXCEPTION 'bonifici di rimborso: riservato agli amministratori' USING ERRCODE = '42501';
  END IF;
  IF p_esito IS NULL OR p_esito NOT IN ('FATTO', 'RESPINTO') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ESITO_SCONOSCIUTO');
  END IF;

  SELECT o.stripe_refund_id INTO v_elenco FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  -- Il segno dev'essere quello scritto sull'ordine, chiave e cifra insieme.
  SELECT EXISTS (
    SELECT 1 FROM unnest(string_to_array(coalesce(v_elenco, ''), ',')) AS x(segno)
     WHERE btrim(x.segno) = format('bonifico:%s:%s', p_centesimi, p_chiave)
  ) INTO v_trovato;
  IF p_centesimi IS NULL OR p_centesimi <= 0 OR p_chiave IS NULL OR NOT v_trovato THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SEGNO_DIVERSO');
  END IF;

  IF p_esito = 'FATTO' THEN
    -- Passa solo se non è già FATTO: due amministratori insieme, il secondo aspetta il primo e
    -- poi non trova niente da aggiornare.
    INSERT INTO private.bonifici_rimborso AS t (chiave, order_id, centesimi, stato, fatto_da, fatto_il)
    VALUES (p_chiave, p_order_id, p_centesimi, 'FATTO', v_chi, now())
    ON CONFLICT (chiave) DO UPDATE
       SET stato = 'FATTO', fatto_da = EXCLUDED.fatto_da, fatto_il = EXCLUDED.fatto_il,
           centesimi = EXCLUDED.centesimi
     WHERE t.stato <> 'FATTO' AND t.order_id = EXCLUDED.order_id
    RETURNING t.chiave INTO v_preso;

    IF v_preso IS NULL THEN
      SELECT * INTO b FROM private.bonifici_rimborso WHERE chiave = p_chiave;
      IF b.order_id IS DISTINCT FROM p_order_id THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'SEGNO_DIVERSO');
      END IF;
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'GIA_FATTO',
        'fatto_da_nome', (SELECT full_name FROM public.profiles WHERE id = b.fatto_da),
        'fatto_il', b.fatto_il
      );
    END IF;
  ELSE
    -- Respinto dalla banca: solo un bonifico segnato FATTO, che torna da fare.
    UPDATE private.bonifici_rimborso
       SET stato = 'RESPINTO', respinto_da = v_chi, respinto_il = now()
     WHERE chiave = p_chiave AND order_id = p_order_id AND stato = 'FATTO'
    RETURNING chiave INTO v_preso;
    IF v_preso IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NON_FATTO');
    END IF;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, metadata)
  VALUES (v_chi,
          CASE WHEN p_esito = 'FATTO' THEN 'refund_transfer.done' ELSE 'refund_transfer.rejected_by_bank' END,
          'orders', p_order_id::text,
          jsonb_build_object('chiave', p_chiave, 'centesimi', p_centesimi));

  RETURN jsonb_build_object('ok', true, 'stato', p_esito);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_segna_bonifico_rimborso(uuid, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_segna_bonifico_rimborso(uuid, text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_segna_bonifico_rimborso(uuid, text, integer, text) TO authenticated;

COMMENT ON FUNCTION public.admin_segna_bonifico_rimborso(uuid, text, integer, text) IS
  'Segna un bonifico di rimborso FATTO (una volta sola: il secondo riceve GIA_FATTO con chi e quando) o RESPINTO dalla banca (torna da fare). Solo amministratori; chiave e centesimi devono essere un segno sull ordine (migrazione 910).';

COMMIT;

NOTIFY pgrst, 'reload schema';

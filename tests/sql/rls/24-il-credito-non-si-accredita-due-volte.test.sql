-- =============================================================================
-- Il credito MyCity non si accredita due volte sullo stesso motivo
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE.
--
-- 27/8/2026 (R132) — La migrazione 126 scriveva nero su bianco: «`wallet_credit`
-- ha una chiave (`p_ref`): con `order_canceled_<id>` un secondo annullo dello
-- stesso ordine non accredita due volte». Non era vero. `wallet_credit` sommava
-- e basta: nessuno guardava il `ref`. L'unica chiave che esisteva copriva un
-- motivo solo, il rimborso in contanti; tutti gli altri — l'annullo del cliente,
-- il rifiuto del negozio, l'annullo dell'amministratore, la scadenza automatica
-- — erano scoperti. Due chiamate con la stessa chiave raddoppiavano il saldo, e
-- quel saldo si spende come denaro.
--
-- La cosa peggiore non era il difetto: era la frase. Chi scriveva il pezzo
-- successivo leggeva «c'e' gia' la protezione» e non ne metteva un'altra.
--
-- COSA CONTROLLA. Non legge il testo delle funzioni: chiama `wallet_credit` due
-- volte con la stessa chiave e guarda il saldo del cliente. E controlla anche il
-- contrario, cioe' che la chiave non sia diventata una gabbia: due clienti
-- diversi che convertono cento punti a testa devono essere accreditati tutti e
-- due, perche' li' il `ref` e' una descrizione («100_pts»), non una chiave.
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'chiara@test.it',  '{"role":"buyer"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'davide@test.it',  '{"role":"buyer"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'erika@test.it',   '{"role":"buyer"}');

-- ── ① Lo stesso annullo, due volte: il credito torna una volta sola ────────
DO $$
DECLARE saldo int; righe int;
BEGIN
  PERFORM public.wallet_credit('aaaaaaaa-0000-0000-0000-000000000001', 1500,
                               'order_canceled', 'order_canceled_9f3a');
  PERFORM public.wallet_credit('aaaaaaaa-0000-0000-0000-000000000001', 1500,
                               'order_canceled', 'order_canceled_9f3a');

  SELECT wallet_balance_cents INTO saldo
    FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  SELECT count(*) INTO righe
    FROM public.wallet_ledger WHERE ref = 'order_canceled_9f3a';

  INSERT INTO esiti VALUES (
    'un ordine annullato due volte restituisce il credito una volta sola',
    saldo = 1500 AND righe = 1,
    format('saldo %s centesimi (atteso 1500), righe a diario %s (attesa 1)', saldo, righe)
  );
END $$;

-- ── ② Un secondo annullo, diverso, deve invece accreditare ────────────────
DO $$
DECLARE saldo int;
BEGIN
  PERFORM public.wallet_credit('aaaaaaaa-0000-0000-0000-000000000001', 700,
                               'order_canceled', 'order_canceled_7c11');
  SELECT wallet_balance_cents INTO saldo
    FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

  INSERT INTO esiti VALUES (
    'un altro ordine annullato accredita comunque (la chiave non blocca tutto)',
    saldo = 2200,
    format('saldo %s centesimi (atteso 2200)', saldo)
  );
END $$;

-- ── ③ Il rimborso in contanti resta protetto com'era ──────────────────────
DO $$
DECLARE saldo int;
BEGIN
  PERFORM public.wallet_credit('aaaaaaaa-0000-0000-0000-000000000002', 2000,
                               'cod_refund', 'return_a1');
  BEGIN
    PERFORM public.wallet_credit('aaaaaaaa-0000-0000-0000-000000000002', 2000,
                                 'cod_refund', 'return_a1');
  EXCEPTION WHEN unique_violation THEN
    -- Prima della riparazione il secondo giro sbatteva sulla chiave parziale
    -- del rimborso in contanti: va bene lo stesso, purche' non accrediti.
    NULL;
  END;
  SELECT wallet_balance_cents INTO saldo
    FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';

  INSERT INTO esiti VALUES (
    'il reso in contanti approvato due volte rimborsa una volta sola',
    saldo = 2000,
    format('saldo %s centesimi (atteso 2000)', saldo)
  );
END $$;

-- ── ④ La chiave non deve mangiarsi i punti fedelta' ───────────────────────
-- `convert_loyalty_to_credit` passa un `ref` che e' una descrizione, non un
-- identificativo: «100_pts». Due clienti che convertono cento punti a testa
-- scrivono la stessa parola. Una chiave che comprendesse anche questo motivo
-- brucerebbe i punti del secondo senza dargli niente in cambio.
DO $$
DECLARE saldo_c int; saldo_e int;
BEGIN
  PERFORM public.wallet_credit('aaaaaaaa-0000-0000-0000-000000000003', 500,
                               'loyalty_convert', '100_pts');
  PERFORM public.wallet_credit('aaaaaaaa-0000-0000-0000-000000000002', 500,
                               'loyalty_convert', '100_pts');

  SELECT wallet_balance_cents INTO saldo_e
    FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003';
  SELECT wallet_balance_cents INTO saldo_c
    FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';

  INSERT INTO esiti VALUES (
    'due clienti che convertono cento punti a testa vengono accreditati entrambi',
    saldo_e = 500 AND saldo_c = 2500,
    format('il terzo cliente ha %s (atteso 500), il secondo %s (atteso 2500)', saldo_e, saldo_c)
  );
END $$;

-- ── ⑤ La spesa non si conta due volte, e non racconta di averla fatta ─────
-- `wallet_debit` restituisce quanto ha tolto davvero: se la chiave dice «questa
-- spesa e' gia' passata», deve rispondere zero, non l'importo. Chi la chiama
-- scala quel numero dal totale da pagare.
DO $$
DECLARE primo int; secondo int; saldo int;
BEGIN
  PERFORM public.wallet_credit('aaaaaaaa-0000-0000-0000-000000000001', 1000,
                               'gift_card_redeem', 'REGALO-2026');
  primo   := public.wallet_debit('aaaaaaaa-0000-0000-0000-000000000001', 300, 'order_cod', 'ordine_5b2');
  secondo := public.wallet_debit('aaaaaaaa-0000-0000-0000-000000000001', 300, 'order_cod', 'ordine_5b2');
  SELECT wallet_balance_cents INTO saldo
    FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

  INSERT INTO esiti VALUES (
    'la stessa spesa non si toglie due volte, e la seconda volta lo dice',
    primo = 300 AND secondo = 0 AND saldo = 2900,
    format('primo addebito %s (atteso 300), secondo %s (atteso 0), saldo %s (atteso 2900)',
           primo, secondo, saldo)
  );
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sul credito MyCity:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il credito non si accredita due volte: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

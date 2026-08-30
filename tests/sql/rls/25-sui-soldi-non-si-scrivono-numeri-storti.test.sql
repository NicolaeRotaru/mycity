-- =============================================================================
-- Sui soldi il database non si fa scrivere numeri storti
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE.
--
-- 27/8/2026 (R036) — Nella catena dei soldi due numeri erano scoperti, e sono
-- proprio i due che diventano un bonifico e uno scontrino:
--
--   · `orders.seller_payout_cents` — quanto finisce sul conto del negoziante —
--     non aveva nessun paletto. Poteva essere negativo, e poteva essere piu'
--     grande dell'incasso dell'ordine.
--   · `order_items.unit_price` — il prezzo della riga — nemmeno. L'unico
--     controllo su quella tabella era la quantita' maggiore di zero, scritto
--     alla nascita (001, riga 41).
--
-- Il criterio del progetto era gia' l'opposto, e si vede dai vicini di casa:
-- il totale non puo' essere negativo, il lordo nemmeno, il rimborso nemmeno e
-- non puo' superare il lordo, il compenso del fattorino sta fra zero e
-- cinquanta euro. Quei due erano rimasti fuori.
--
-- Oggi quei numeri li scrive solo il server e li calcola bene: non c'era un
-- danno in corso. Il paletto e' la cintura di sicurezza per il giorno in cui una
-- riparazione sbaglia un conto: senza, l'errore passa in silenzio ed esce dalla
-- banca; con, si ferma sulla riga.
--
-- COSA CONTROLLA. Non cerca il nome del vincolo nel catalogo: prova a scrivere
-- davvero i numeri sbagliati e pretende un rifiuto, e poi scrive i numeri giusti
-- e pretende che passino — un paletto che blocca anche il lavoro onesto e'
-- peggio del buco.
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('bbbbbbbb-0000-0000-0000-00000000000a', 'fornaio@test.it', '{"role":"seller"}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'cliente@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a';

INSERT INTO public.products (id, name, description, price, seller_id, status, stock)
VALUES ('bbbbbbbb-1111-0000-0000-00000000000c', 'Michetta',
        'Pane di grano tenero, cotto la mattina',
        0.50, 'bbbbbbbb-0000-0000-0000-00000000000a', 'available', 100);

-- Un ordine sano che serve da appoggio alle righe d'ordine.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, seller_payout_cents,
  payment_method, payment_status, delivery_status, payout_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'bbbbbbbb-2222-0000-0000-00000000000d',
  'bbbbbbbb-0000-0000-0000-00000000000b',
  'bbbbbbbb-0000-0000-0000-00000000000a',
  10.00, 1000, 900, 'card', 'PAID', 'NEW', 'HELD',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- Aiuto: prova a eseguire un comando e dice se il database l'ha rifiutato.
CREATE OR REPLACE FUNCTION pg_temp.rifiutato(p_sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;   -- e' passato: nessun paletto
EXCEPTION WHEN check_violation THEN
  RETURN true;    -- fermato dal paletto, che e' quello che vogliamo
END $$;

-- ── ① Il compenso del negozio non puo' essere negativo ────────────────────
DO $$
DECLARE fermato boolean;
BEGIN
  fermato := pg_temp.rifiutato($q$
    UPDATE public.orders SET seller_payout_cents = -500
     WHERE id = 'bbbbbbbb-2222-0000-0000-00000000000d'
  $q$);
  INSERT INTO esiti VALUES (
    'un compenso negativo al negozio non si scrive',
    fermato,
    CASE WHEN fermato THEN 'il database lo rifiuta'
         ELSE 'PASSATO: meno cinque euro sul conto del fornaio sono finiti in tabella' END
  );
END $$;

-- ── ② Il compenso non puo' superare l'incasso dell'ordine ────────────────
DO $$
DECLARE fermato boolean;
BEGIN
  fermato := pg_temp.rifiutato($q$
    UPDATE public.orders SET seller_payout_cents = 1500
     WHERE id = 'bbbbbbbb-2222-0000-0000-00000000000d'
  $q$);
  INSERT INTO esiti VALUES (
    'al negozio non si promette piu di quanto l''ordine ha incassato',
    fermato,
    CASE WHEN fermato THEN 'il database lo rifiuta'
         ELSE 'PASSATO: quindici euro di compenso su un ordine da dieci' END
  );
END $$;

-- ── ③ Un compenso sensato deve passare ───────────────────────────────────
DO $$
DECLARE fermato boolean; valore int;
BEGIN
  fermato := pg_temp.rifiutato($q$
    UPDATE public.orders SET seller_payout_cents = 850
     WHERE id = 'bbbbbbbb-2222-0000-0000-00000000000d'
  $q$);
  SELECT seller_payout_cents INTO valore
    FROM public.orders WHERE id = 'bbbbbbbb-2222-0000-0000-00000000000d';
  INSERT INTO esiti VALUES (
    'il compenso vero del negozio si scrive senza intoppi',
    NOT fermato AND valore = 850,
    format('scritto %s (atteso 850), rifiutato: %s', valore, fermato)
  );
END $$;

-- ── ④ Il prezzo di una riga d'ordine non puo' essere negativo ────────────
DO $$
DECLARE fermato boolean;
BEGIN
  fermato := pg_temp.rifiutato($q$
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES ('bbbbbbbb-2222-0000-0000-00000000000d',
            'bbbbbbbb-1111-0000-0000-00000000000c', 1, -3.00)
  $q$);
  INSERT INTO esiti VALUES (
    'una riga d''ordine a prezzo negativo non si scrive',
    fermato,
    CASE WHEN fermato THEN 'il database lo rifiuta'
         ELSE 'PASSATO: una michetta a meno tre euro e in fattura' END
  );
END $$;

-- ── ⑤ Una riga d'ordine normale deve passare ─────────────────────────────
DO $$
DECLARE fermato boolean; righe int;
BEGIN
  fermato := pg_temp.rifiutato($q$
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES ('bbbbbbbb-2222-0000-0000-00000000000d',
            'bbbbbbbb-1111-0000-0000-00000000000c', 2, 0.50)
  $q$);
  SELECT count(*) INTO righe FROM public.order_items
   WHERE order_id = 'bbbbbbbb-2222-0000-0000-00000000000d';
  INSERT INTO esiti VALUES (
    'una riga d''ordine normale si scrive senza intoppi',
    NOT fermato AND righe = 1,
    format('righe scritte %s (attesa 1), rifiutato: %s', righe, fermato)
  );
END $$;

-- ── ⑥ Un prezzo a zero resta legittimo (l'omaggio in cassa) ──────────────
DO $$
DECLARE fermato boolean;
BEGIN
  fermato := pg_temp.rifiutato($q$
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES ('bbbbbbbb-2222-0000-0000-00000000000d',
            'bbbbbbbb-1111-0000-0000-00000000000c', 1, 0)
  $q$);
  INSERT INTO esiti VALUES (
    'la riga in omaggio a zero euro resta possibile',
    NOT fermato,
    CASE WHEN fermato THEN 'RIFIUTATA: il paletto e stretto troppo' ELSE 'passa' END
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
    RAISE EXCEPTION E'% controllo/i rosso/i sui paletti dei soldi:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'sui soldi i paletti tengono: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

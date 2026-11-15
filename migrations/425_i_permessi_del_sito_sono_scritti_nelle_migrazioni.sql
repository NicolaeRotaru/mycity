-- I permessi del sito sono scritti nelle migrazioni, non ereditati.
--
-- IL DIFETTO (R18-021). Le migrazioni contavano sul permesso di partenza che Supabase dava una volta
-- a ogni oggetto nuovo dello schema public: ALL ad anon, authenticated e service_role su tabelle,
-- viste e sequenze, EXECUTE sulle funzioni. Da sole non concedevano quasi mai niente; la 114, la 119,
-- la 145, la 151 e la 215 restringono permessi che danno per gia' concessi. Su un progetto Supabase
-- nuovo, con le regole di novembre 2026, quel permesso di partenza non c'e' piu': le migrazioni girano
-- senza un errore, poi i visitatori non leggono 75 tabelle su 76, products compresa, e il sito
-- ricostruito da zero (ambiente di prova, ripristino dopo un disastro, cambio di progetto) e' vuoto.
-- Il sito vero oggi non e' toccato: e' nato coi permessi di una volta.
--
-- LA CURA. Qui sotto i permessi che il sito vero ha, scritti uno per uno. Sono quelli del database
-- ricostruito da tutte le migrazioni fino alla 424 coi permessi di partenza di una volta (come e' nato
-- il sito vero), con tre strette e nessuna aggiunta:
--   · niente TRIGGER, TRUNCATE e REFERENCES ad anon e authenticated: il sito non li usa;
--   · niente SELECT su profiles ad anon: in produzione e' gia' tolto a mano (R18-024, migrazione 426);
--   · delle due sequenze, solo USAGE su product_views_id_seq, che serve alla visita scritta dal
--     browser; kyc_file_da_togliere la scrivono funzioni coi permessi del creatore.
-- Funzioni: EXECUTE a chi lo ha oggi per nome (anon, authenticated, service_role), solo per le 86
-- che non sono grilletti (un grilletto non chiede EXECUTE a chi scrive la riga). Quelle aperte a
-- tutti (PUBLIC) lo restano da sole: Postgres da' EXECUTE a PUBLIC a ogni funzione nuova.
-- service_role: lettura e scrittura su tutte le tabelle e le viste, USAGE sulle sequenze, come oggi.
--
-- Sul sito vero non cambia niente: ogni riga concede un permesso che c'e' gia' (GRANT di un permesso
-- gia' dato non fa nulla). Un oggetto dell'elenco che nel database non c'e' (una migrazione non
-- ancora applicata, come la 158 nella prova tests/sql/harness/la-158-…) si salta con un avviso,
-- invece di fermare tutto. Il controllo in fondo ferma la migrazione se una tabella senza RLS
-- risultasse aperta ad anon o authenticated.
--
-- PER LE MIGRAZIONI DI DOMANI: una tabella, una vista o una funzione nuova scrive i suoi GRANT
-- accanto alle sue regole. Il permesso di partenza non va piu' dato per scontato.
--
-- REVERSIBILE: sul sito vero non c'e' niente da togliere. Su un progetto nuovo, REVOKE degli stessi
-- permessi riporta allo stato senza (il catalogo vuoto per tutti).
--
-- LA PROVA: tests/sql/rls/riparazione-r18-permessi-scritti.test.sql. Visitatore, cliente, negozio e
-- server fanno quello che fanno sul sito vero. Morde su un database costruito senza i permessi di
-- partenza (tests/sql/harness/00_shim_supabase.sql senza le righe ALTER DEFAULT PRIVILEGES … GRANT).

BEGIN;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Tabelle: chi legge e chi scrive dal browser (le regole per riga decidono quali righe).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('abandoned_carts',        'SELECT', 'anon, authenticated'),
    ('abandoned_carts',        'INSERT, UPDATE, DELETE', 'authenticated'),
    ('achievements',           'SELECT', 'anon, authenticated'),
    ('activity_events',        'SELECT', 'anon, authenticated'),
    ('audit_logs',             'SELECT', 'anon, authenticated'),
    ('cashback_campaigns',     'SELECT', 'anon, authenticated'),
    ('cashback_campaigns',     'INSERT, UPDATE, DELETE', 'authenticated'),
    ('cashback_redemptions',   'SELECT', 'anon, authenticated'),
    ('catalog_ai_jobs',        'SELECT', 'anon, authenticated'),
    ('categories',             'SELECT', 'anon, authenticated'),
    ('cms_pages',              'SELECT', 'anon, authenticated'),
    ('cod_reconciliations',    'SELECT', 'anon, authenticated'),
    ('cod_reconciliations',    'INSERT, UPDATE, DELETE', 'authenticated'),
    ('consent_log',            'SELECT', 'anon, authenticated'),
    ('contact_messages',       'SELECT, INSERT', 'anon, authenticated'),
    ('contact_messages',       'UPDATE', 'authenticated'),
    ('conversations',          'SELECT', 'anon, authenticated'),
    ('conversations',          'INSERT', 'authenticated'),
    ('coupons',                'SELECT, INSERT, UPDATE, DELETE', 'authenticated'),
    ('daily_drops',            'SELECT', 'anon, authenticated'),
    ('daily_stories',          'SELECT', 'anon, authenticated'),
    ('disputes',               'SELECT', 'anon, authenticated'),
    ('disputes',               'INSERT, UPDATE', 'authenticated'),
    ('event_rsvps',            'SELECT', 'anon, authenticated'),
    ('event_rsvps',            'INSERT, UPDATE, DELETE', 'authenticated'),
    ('favorites',              'SELECT', 'anon, authenticated'),
    ('favorites',              'INSERT, UPDATE, DELETE', 'authenticated'),
    ('follows',                'SELECT', 'anon, authenticated'),
    ('follows',                'INSERT, DELETE', 'authenticated'),
    ('gift_cards',             'SELECT', 'anon, authenticated'),
    ('group_orders',           'SELECT', 'anon, authenticated'),
    ('group_orders',           'INSERT, UPDATE', 'authenticated'),
    ('group_participants',     'SELECT', 'anon, authenticated'),
    ('group_participants',     'INSERT, DELETE', 'authenticated'),
    ('loyalty_accounts',       'SELECT', 'anon, authenticated'),
    ('loyalty_transactions',   'SELECT', 'anon, authenticated'),
    ('marketplace_events',     'SELECT', 'anon, authenticated'),
    ('marketplace_events',     'INSERT, UPDATE, DELETE', 'authenticated'),
    ('messages',               'SELECT', 'anon, authenticated'),
    ('messages',               'INSERT, UPDATE', 'authenticated'),
    ('newsletter_subscribers', 'SELECT', 'anon, authenticated'),
    ('notifications',          'SELECT', 'anon, authenticated'),
    ('order_delivery_codes',   'SELECT', 'anon, authenticated'),
    ('order_items',            'SELECT', 'anon, authenticated'),
    ('order_pickup_codes',     'SELECT', 'anon, authenticated'),
    ('orders',                 'SELECT', 'anon, authenticated'),
    ('orders',                 'UPDATE', 'authenticated'),
    ('payment_attempts',       'SELECT', 'authenticated'),
    ('pending_checkouts',      'SELECT', 'anon, authenticated'),
    ('product_list_items',     'SELECT', 'anon, authenticated'),
    ('product_list_items',     'INSERT, UPDATE, DELETE', 'authenticated'),
    ('product_lists',          'SELECT', 'anon, authenticated'),
    ('product_lists',          'INSERT, UPDATE, DELETE', 'authenticated'),
    ('product_questions',      'SELECT', 'anon, authenticated'),
    ('product_questions',      'INSERT, UPDATE', 'authenticated'),
    ('product_variants',       'SELECT', 'anon, authenticated'),
    ('product_variants',       'INSERT, UPDATE, DELETE', 'authenticated'),
    ('product_views',          'SELECT, INSERT', 'anon, authenticated'),
    ('product_views_daily',    'SELECT', 'anon, authenticated'),
    ('products',               'SELECT', 'anon, authenticated'),
    ('products',               'INSERT, UPDATE, DELETE', 'authenticated'),
    ('profiles',               'SELECT, INSERT, UPDATE', 'authenticated'),
    ('push_subscriptions',     'SELECT', 'anon, authenticated'),
    ('push_subscriptions',     'INSERT, UPDATE, DELETE', 'authenticated'),
    ('recently_viewed',        'SELECT', 'anon, authenticated'),
    ('recently_viewed',        'INSERT, UPDATE, DELETE', 'authenticated'),
    ('referrals',              'SELECT', 'anon, authenticated'),
    ('returns',                'SELECT', 'anon, authenticated'),
    ('review_helpful',         'SELECT', 'anon, authenticated'),
    ('review_helpful',         'INSERT, DELETE', 'authenticated'),
    ('reviews',                'SELECT', 'anon, authenticated'),
    ('reviews',                'INSERT', 'authenticated'),
    ('rider_reviews',          'SELECT', 'anon, authenticated'),
    ('rider_reviews',          'INSERT', 'authenticated'),
    ('rider_sos_events',       'SELECT', 'anon, authenticated'),
    ('rider_sos_events',       'INSERT, UPDATE, DELETE', 'authenticated'),
    ('segnalazioni',           'INSERT', 'anon, authenticated'),
    ('segnalazioni',           'SELECT, UPDATE', 'authenticated'),
    ('seller_promotions',      'SELECT', 'anon, authenticated'),
    ('seller_promotions',      'INSERT, UPDATE, DELETE', 'authenticated'),
    ('seller_stories',         'SELECT', 'anon, authenticated'),
    ('seller_stories',         'INSERT, UPDATE, DELETE', 'authenticated'),
    ('seller_story_views',     'SELECT', 'anon, authenticated'),
    ('seller_story_views',     'INSERT, UPDATE, DELETE', 'authenticated'),
    ('shop_of_month',          'SELECT', 'anon, authenticated'),
    ('shop_of_month',          'INSERT, UPDATE, DELETE', 'authenticated'),
    ('shop_of_month_votes',    'SELECT', 'anon, authenticated'),
    ('shop_of_month_votes',    'INSERT, UPDATE, DELETE', 'authenticated'),
    ('site_settings',          'SELECT', 'anon, authenticated'),
    ('sponsored_listings',     'SELECT', 'anon, authenticated'),
    ('sponsored_listings',     'INSERT, UPDATE, DELETE', 'authenticated'),
    ('store_reviews',          'SELECT', 'anon, authenticated'),
    ('store_reviews',          'INSERT', 'authenticated'),
    ('subscription_orders',    'SELECT', 'anon, authenticated'),
    ('subscription_orders',    'UPDATE', 'authenticated'),
    ('user_achievements',      'SELECT', 'anon, authenticated'),
    ('user_addresses',         'SELECT', 'anon, authenticated'),
    ('user_addresses',         'INSERT, UPDATE, DELETE', 'authenticated'),
    ('user_carts',             'SELECT', 'anon, authenticated'),
    ('user_carts',             'INSERT, UPDATE, DELETE', 'authenticated'),
    ('wallet_ledger',          'SELECT', 'anon, authenticated'),
    ('zone_code_uses',         'SELECT', 'anon, authenticated'),
    ('zone_codes',             'SELECT, INSERT, UPDATE, DELETE', 'authenticated')
  ) AS v(oggetto, permessi, ruoli)
  LOOP
    IF to_regclass('public.' || quote_ident(r.oggetto)) IS NULL THEN
      RAISE WARNING '425: public.% non c''e'', i suoi permessi si saltano', r.oggetto;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT %s ON public.%I TO %s', r.permessi, r.oggetto, r.ruoli);
  END LOOP;
END $$;

-- Due colonne che il browser aggiorna da solo, senza poter toccare il resto della riga.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('conversations', 'UPDATE (buyer_unread_count, seller_unread_count)', 'authenticated'),
    ('notifications', 'UPDATE (is_read)', 'authenticated')
  ) AS v(oggetto, permessi, ruoli)
  LOOP
    IF to_regclass('public.' || quote_ident(r.oggetto)) IS NULL THEN
      RAISE WARNING '425: public.% non c''e'', i suoi permessi si saltano', r.oggetto;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT %s ON public.%I TO %s', r.permessi, r.oggetto, r.ruoli);
  END LOOP;
END $$;

-- Viste.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('live_activity_public',      'SELECT', 'anon, authenticated'),
    ('nomi_pubblici',             'SELECT', 'authenticated'),
    ('ordini_disponibili_rider',  'SELECT', 'authenticated'),
    ('referral_leaderboard',      'SELECT', 'authenticated'),
    ('rider_consegne_storico',    'SELECT', 'authenticated'),
    ('rider_reviews_ricevute',    'SELECT', 'authenticated'),
    ('seller_public_profiles',    'SELECT', 'anon, authenticated'),
    ('shop_of_month_leaderboard', 'SELECT', 'anon, authenticated'),
    ('sponsored_active_public',   'SELECT', 'anon, authenticated')
  ) AS v(oggetto, permessi, ruoli)
  LOOP
    IF to_regclass('public.' || quote_ident(r.oggetto)) IS NULL THEN
      RAISE WARNING '425: public.% non c''e'', i suoi permessi si saltano', r.oggetto;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT %s ON public.%I TO %s', r.permessi, r.oggetto, r.ruoli);
  END LOOP;
END $$;

-- La sequenza della visita scritta dal browser (product_views.id).
DO $$
BEGIN
  IF to_regclass('public.product_views_id_seq') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE ON SEQUENCE public.product_views_id_seq TO anon, authenticated';
  END IF;
END $$;

-- Funzioni (non i grilletti): a chi le chiama per nome oggi.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'active_promo_products(integer,uuid)',
    'activity_key_sensibile(text)',
    'categorie_per_negozio()',
    'event_rsvp_counts()',
    'generate_verification_code()',
    'is_admin()',
    'is_rider_approvato()',
    'mese_di_piacenza(timestamp with time zone)',
    'negozi_aperti_adesso()',
    'negozio_approvato(uuid)',
    'ordini_recenti_del_prodotto(uuid)',
    'prodotti_con_voto_almeno(numeric)',
    'prodotto_in_vetrina(uuid)',
    'product_active_discount(uuid)',
    'product_active_discounts(uuid[])',
    'product_rating_stats(uuid[])',
    'radice_con_obbligo_alimentare(uuid)',
    'search_products_smart(text,integer)',
    'store_cards(integer,integer)',
    'store_follower_count(uuid)',
    'store_review_stats(uuid[])',
    'track_sponsored_click(uuid)',
    'track_sponsored_impression(uuid)',
    'track_story_view(uuid)',
    'trending_product_ids_24h(integer)',
    'vetrina_home(date)'
  ] LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN
      RAISE WARNING '425: public.% non c''e'', il suo permesso si salta', f;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated, service_role', f);
  END LOOP;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_chiudi_consegna(uuid,integer,text)',
    'admin_kpi()',
    'admin_list_user_emails()',
    'andamento_del_negozio()',
    'cancel_order(uuid)',
    'check_coupon(text,numeric)',
    'confirm_cod_remittance(uuid,date)',
    'confirm_pickup_by_seller(uuid,text)',
    'convert_loyalty_to_credit(integer)',
    'event_rsvp_count(uuid)',
    'get_referral_leaderboard()',
    'is_rider_in_regola()',
    'mark_conversation_read(uuid)',
    'nomi_dei_clienti_del_negozio(uuid[])',
    'numeri_del_negozio(uuid,integer)',
    'prendi_ordine(uuid)',
    'redeem_gift_card(text)',
    'rider_release_order(uuid)',
    'salva_varianti(uuid,uuid[],jsonb,jsonb)',
    'seller_reject_order(uuid,text)',
    'shop_of_month_vote_counts(date)',
    'touch_loyalty_streak()',
    'venduti_per_prodotto(uuid[])',
    'verify_delivery_code(uuid,text)',
    'verify_pickup_code(uuid,text)',
    'visite_prodotti_venditore(integer)'
  ] LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN
      RAISE WARNING '425: public.% non c''e'', il suo permesso si salta', f;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_wallet_apply(uuid,integer,text,text)',
    'accoda_email_del_benvenuto(uuid)',
    'accumula_rimborso(uuid,integer)',
    'award_loyalty_points(uuid,integer,text,uuid)',
    'chi_sta_contando()',
    'claim_coupon(text)',
    'claim_coupon(text,uuid)',
    'claim_pending_emails(integer)',
    'consolida_visite_prodotto(integer)',
    'disiscrivi(text,text)',
    'documenti_da_cancellare_respinti(integer)',
    'foto_consegna_da_cancellare(integer)',
    'gift_card_void_for_payment(text,text,text)',
    'increment_coupon_usage(text)',
    'kyc_file_da_togliere_prendi()',
    'kyc_file_da_togliere_rimetti(uuid,text[])',
    'list_abandoned_carts_to_recover(integer)',
    'mark_abandoned_cart_email_sent(uuid)',
    'pota_consent_log(integer)',
    'process_expired_deletions()',
    'punti_fedelta_accesi()',
    'registra_spesa_ai(date,bigint)',
    'release_coupon(text)',
    'release_coupon(text,uuid)',
    'reserve_stock(jsonb)',
    'restore_stock(jsonb)',
    'restore_stock_for_order(uuid)',
    'spesa_ai_di_oggi(date)',
    'sponsored_sotto_tetto(uuid,text,integer,integer)',
    'storna_rimborso(uuid,integer)',
    'unlock_achievement(uuid,text)',
    'vuole_notifica(uuid,text)',
    'wallet_credit(uuid,integer,text,text)',
    'wallet_debit(uuid,integer,text,text)'
  ] LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN
      RAISE WARNING '425: public.% non c''e'', il suo permesso si salta', f;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- ── Il server ──
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Mai un permesso del browser su una tabella senza RLS.
DO $$
DECLARE scoperte text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO scoperte
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
     AND (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
          OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'));
  IF scoperte IS NOT NULL THEN
    RAISE EXCEPTION '425: tabelle senza RLS aperte ad anon o authenticated: %', scoperte;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

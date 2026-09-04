-- Diciannove funzioni con i permessi del creatore sono in mano a chi non ha fatto l'accesso.
--
-- IL DIFETTO. Su Supabase l'advisor di sicurezza (letto in produzione il 3/9/2026 alle 16:45) ne
-- conta quattordici; sul database ricostruito da tutte e 145 le migrazioni ne conta DICIANNOVE — le
-- cinque in piu' sono quelle delle migrazioni 122 e 129, scritte e non ancora applicate. Sedici delle
-- diciannove non guardano mai chi le sta chiamando. Due SCRIVONO: `track_sponsored_click` e
-- `track_sponsored_impression`, cioe' i clic e le visualizzazioni degli annunci a pagamento — i
-- numeri che un giorno mostreremo a chi ha pagato.
--
-- LA CAUSA, ED E' LA STESSA DI SEMPRE: QUI UN OGGETTO NASCE APERTO, E I RUBINETTI SONO DUE.
--   · Postgres concede da solo EXECUTE a PUBLIC su ogni funzione nuova;
--   · l'impalcatura Supabase, in piu', concede EXECUTE ad `anon` su ogni funzione futura dello
--     schema `public` (ALTER DEFAULT PRIVILEGES).
-- Chiuderne uno solo non chiude niente, e questo repo ha gia' sbagliato in tutti e due i versi:
--   · «REVOKE … FROM anon, authenticated» senza PUBLIC — cinque volte in due migrazioni (e' la
--     storia scritta in tests/sql/rls/10);
--   · «REVOKE … FROM public» senza anon — migrazione 114 riga 55 su `is_rider_approvato`, che
--     infatti oggi, in produzione, e' ancora chiamabile da un anonimo.
--
-- COSA NON SI PUO' FARE, E L'HO PROVATO. La strada pulita sarebbe chiudere il rubinetto per il
-- futuro, come la 145 ha fatto per le tabelle. Su Postgres 16 non funziona:
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- non lascia NESSUNA riga in pg_default_acl e la funzione creata subito dopo nasce lo stesso con
-- `=X/…`, cioe' eseguibile da chiunque (provato su un database vuoto il 3/9/2026: `has_function_
-- privilege` risponde ancora «vero»). Un divieto di default per le funzioni, nel database, NON
-- ESISTE. Restano due strade: un trigger di evento che revochi a ogni CREATE FUNCTION — scartata,
-- perche' un CREATE OR REPLACE su una funzione della vetrina le toglierebbe il permesso in silenzio
-- e spegnerebbe il sito senza un errore — oppure tenere le funzioni pubbliche in uno schema loro e
-- promuoverle a mano. Finche' non si fa quello, l'unico posto in cui il divieto puo' vivere e' un
-- guardiano che legge le migrazioni e diventa rosso da solo:
-- tests/unit/nessuna-funzione-potente-in-mano-a-chi-non-ha-l-account.test.ts.
--
-- QUELLO CHE IL FIX OVVIO AVREBBE ROTTO. «Revocare EXECUTE ad anon dove non serve» sembra una riga
-- sola. Quattro di queste funzioni stanno DENTRO le regole di lettura riga-per-riga, e chi legge una
-- tabella deve poter eseguire la funzione che la sua regola richiama. Misurato sul database vero:
--     REVOKE EXECUTE ON FUNCTION public.negozio_approvato(uuid) FROM anon;
--     SET ROLE anon; SELECT count(*) FROM public.products;
--     → ERROR: permission denied for function negozio_approvato
-- Cioe': il catalogo pubblico smette di esistere per chi non ha l'account. Stessa risposta per
-- `is_admin()` (28 regole, fra cui `products`), `prodotto_in_vetrina(uuid)` (`reviews`,
-- `product_variants`) e `is_rider_approvato()` (`orders`). Quelle quattro RESTANO aperte, e qui sotto
-- c'e' scritto perche', in un commento che vive nel database: cosi' chi legge l'avviso dell'advisor
-- fra sei mesi non le «ripara» spegnendo la vetrina.
--
-- COSA FA QUESTA MIGRAZIONE, in quattro mosse.
--   ① Chiude ad `anon` le quattro funzioni che nessuna riga di codice chiama e nessuna regola usa —
--     cercate una per una in app/, lib/ e components/, e nel catalogo fra i corpi delle altre
--     funzioni e delle viste. Chiude TUTTI E DUE i rubinetti, PUBLIC e anon.
--   ② Chiude ad `anon` la vista `referral_leaderboard`, che nessun avviso segnalava: e' l'unica
--     porta da cui `get_referral_leaderboard()` restava raggiungibile, e restituisce NOME E COGNOME
--     di cinquanta persone. Nessuno che non abbia l'account deve poterla leggere: la pagina che la
--     usa (app/profile/referral/leaderboard) sta dietro l'accesso.
--   ③ Mette un tetto PER CHI CHIAMA sulle due funzioni che scrivono i numeri degli annunci.
--   ④ Scrive nel database, come commento, perche' le altre restano aperte.
--
-- REVERSIBILE: le concessioni tolte si rimettono con `GRANT EXECUTE ON FUNCTION … TO anon` (e
-- `GRANT SELECT ON public.referral_leaderboard TO anon`), cioe' rimettendo il difetto. Il tetto per
-- chiamante si toglie riportando `sponsored_sotto_tetto` alla forma della migrazione 122.
--
-- COSA NON HO VERIFICATO DA QUI: il comportamento del proxy di Supabase sulle intestazioni della
-- richiesta (punto ③). Il codice e' scritto per non peggiorare niente se quelle intestazioni non
-- arrivano — in quel caso vale esattamente il tetto di oggi.

-- =========================================================
-- ① LE QUATTRO CHE NESSUNO CHIAMA
-- =========================================================
-- Cercate in app/, lib/ e components/ (nessun `supabase.rpc('…')`) e nel catalogo (non compaiono nel
-- corpo di nessuna regola, di nessuna vista, di nessun'altra funzione). `event_rsvp_count` e' la
-- forma singolare: il sito usa solo `event_rsvp_counts()`, al plurale, che resta aperta.
-- Restano a `authenticated` e a `service_role`: qui si chiude solo la porta di chi non ha l'account.
REVOKE EXECUTE ON FUNCTION public.event_rsvp_count(uuid)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_referral_leaderboard()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.referral_reward_fisso()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.shop_of_month_vote_counts(date) FROM PUBLIC, anon;

-- =========================================================
-- ② LA CLASSIFICA DEGLI INVITI NON E' ROBA DA VETRINA
-- =========================================================
-- `referral_leaderboard` ha `security_invoker = on`, quindi nessun avviso la segnala; ma il suo
-- corpo e' una chiamata sola a `get_referral_leaderboard()`, che gira coi permessi del creatore e
-- scavalca le regole di lettura esattamente come una vista potente. Dentro c'e' `profiles.full_name`
-- di cinquanta persone: il nome vero di clienti veri, servito a chiunque abbia la chiave pubblica.
-- Il permesso di leggerla ce l'aveva `anon` per nascita, non per scelta di nessuno.
REVOKE ALL    ON public.referral_leaderboard FROM PUBLIC, anon;
GRANT  SELECT ON public.referral_leaderboard TO authenticated;

COMMENT ON VIEW public.referral_leaderboard IS
  'Classifica inviti: contiene nomi di persone. Solo per chi ha fatto l''accesso — non concederla ad anon.';

-- =========================================================
-- ③ I NUMERI DEGLI ANNUNCI: UN TETTO PER CHI CHIAMA, NON SOLO PER CAMPAGNA
-- =========================================================
-- COME LE CHIAMA IL SITO, davvero: components/SponsoredCarousel.tsx, righe 102 e 144, dal browser,
-- con la chiave pubblica. Chi guarda un banner quasi sempre non ha l'account: revocare ad `anon` e
-- basta spegnerebbe il conteggio per la maggior parte del traffico vero. Portare la chiamata sul
-- server e' la strada giusta, ma tocca il codice del sito e non si fa da una migrazione.
--
-- IL TETTO C'ERA GIA' (migrazione 122) ED E' PER CAMPAGNA: sessanta visualizzazioni e dieci clic al
-- minuto, per campagna, sommando tutti. Fa due cose sbagliate:
--   · un solo copione anonimo se lo prende TUTTO da solo — 14.400 clic finti al giorno per campagna;
--   · e proprio per questo AFFAMA il conteggio vero: superato il tetto, le visualizzazioni delle
--     persone vere di quel minuto vengono buttate via in silenzio.
-- Il tetto per chi chiama risolve tutte e due: ciascuno ha il suo secchio.
--
-- CHI E' «CHI CHIAMA», in ordine di affidabilita':
--   1. l'identificativo dell'utente, se ha fatto l'accesso — arriva dal token firmato, non si finge;
--   2. altrimenti l'indirizzo del chiamante letto dalle intestazioni della richiesta. Di
--      `x-forwarded-for` si prende l'ULTIMO salto: i primi li puo' scrivere il chiamante, l'ultimo
--      lo aggiunge il nostro proxy;
--   3. se non c'e' nessuna delle due, un secchio unico — e in quel caso vale il tetto di prima,
--      identico a oggi. Cosi', se le intestazioni non arrivano, questa migrazione non toglie
--      NIENTE al conteggio vero: nel peggiore dei casi siamo dove eravamo.
-- Onesta': con l'indirizzo, un attaccante da un indirizzo solo passa da 14.400 a 4.320 clic finti al
-- giorno. Non e' zero. Zero si ottiene solo togliendo la scrittura dal browser.

CREATE OR REPLACE FUNCTION public.chi_sta_contando()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_utente       uuid;
  v_intestazioni json;
  v_catena       text;
  v_indirizzo    text;
BEGIN
  v_utente := auth.uid();
  IF v_utente IS NOT NULL THEN
    RETURN 'utente:' || v_utente::text;
  END IF;

  BEGIN
    v_intestazioni := nullif(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN others THEN
    v_intestazioni := NULL;   -- fuori da una chiamata web non c'e' niente da leggere
  END;

  IF v_intestazioni IS NOT NULL THEN
    v_catena := coalesce(v_intestazioni ->> 'x-forwarded-for', '');
    v_indirizzo := coalesce(
      v_intestazioni ->> 'cf-connecting-ip',
      v_intestazioni ->> 'x-real-ip',
      nullif(btrim(split_part(v_catena, ',',
        greatest(array_length(string_to_array(v_catena, ','), 1), 1))), '')
    );
  END IF;

  IF v_indirizzo IS NOT NULL THEN
    RETURN 'indirizzo:' || v_indirizzo;
  END IF;

  RETURN '(non identificato)';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.chi_sta_contando() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.chi_sta_contando() IS
  'Chi sta chiamando, per i tetti: utente se ha l''accesso, altrimenti indirizzo, altrimenti nessuno.';

-- Il secchio diventa uno per chiamante. La tabella tiene solo conteggi al minuto: si puo' svuotare.
DELETE FROM public.sponsored_tracking_rate;
ALTER TABLE public.sponsored_tracking_rate
  ADD COLUMN IF NOT EXISTS chiamante text NOT NULL DEFAULT '(tutti)';
ALTER TABLE public.sponsored_tracking_rate DROP CONSTRAINT IF EXISTS sponsored_tracking_rate_pkey;
ALTER TABLE public.sponsored_tracking_rate
  ADD CONSTRAINT sponsored_tracking_rate_pkey PRIMARY KEY (campaign_id, kind, chiamante, minuto);

DROP FUNCTION IF EXISTS public.sponsored_sotto_tetto(uuid, text, int);

CREATE OR REPLACE FUNCTION public.sponsored_sotto_tetto(
  p_id             uuid,
  p_kind           text,
  p_tetto_suo      int,   -- quanto puo' contare UN chiamante in un minuto
  p_tetto_campagna int    -- quanto puo' contare la campagna in un minuto, tutti insieme
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minuto    timestamptz := date_trunc('minute', now());
  v_chi       text        := public.chi_sta_contando();
  v_suo       int;
  v_campagna  int;
BEGIN
  -- pulizia occasionale: le righe piu' vecchie di un giorno non servono a niente
  IF random() < 0.01 THEN
    DELETE FROM public.sponsored_tracking_rate WHERE minuto < now() - interval '1 day';
  END IF;

  -- Prima il secchio di chi chiama. L'ORDINE CONTA, ed e' il motivo per cui la prima stesura di
  -- questa migrazione era sbagliata: se si conta prima la campagna, i tentativi respinti consumano
  -- lo stesso il soffitto della campagna, e chi manda cinquanta richieste al minuto continua ad
  -- affamare il conteggio delle persone vere anche senza guadagnarci un clic. Misurato: cinquanta
  -- tentativi da un indirizzo mangiavano tutti e dieci i clic del minuto. Contando prima il
  -- chiamante, un attaccante da un indirizzo si prende tre e lascia agli altri i sette che restano.
  IF v_chi <> '(non identificato)' THEN
    INSERT INTO public.sponsored_tracking_rate (campaign_id, kind, chiamante, minuto, conteggio)
    VALUES (p_id, p_kind, v_chi, v_minuto, 1)
    ON CONFLICT (campaign_id, kind, chiamante, minuto)
    DO UPDATE SET conteggio = public.sponsored_tracking_rate.conteggio + 1
    RETURNING conteggio INTO v_suo;

    IF v_suo > p_tetto_suo THEN
      RETURN false;   -- respinto qui: il soffitto della campagna resta intatto per gli altri
    END IF;
  END IF;

  -- il secchio della campagna: c'era prima, resta come secondo soffitto. Se non so chi chiama e'
  -- l'unico che vale, cioe' esattamente il comportamento di oggi: mai peggio di prima.
  INSERT INTO public.sponsored_tracking_rate (campaign_id, kind, chiamante, minuto, conteggio)
  VALUES (p_id, p_kind, '(tutti)', v_minuto, 1)
  ON CONFLICT (campaign_id, kind, chiamante, minuto)
  DO UPDATE SET conteggio = public.sponsored_tracking_rate.conteggio + 1
  RETURNING conteggio INTO v_campagna;

  RETURN v_campagna <= p_tetto_campagna;
END;
$$;

CREATE OR REPLACE FUNCTION public.track_sponsored_impression(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- venti visualizzazioni al minuto a testa: nessuna persona vera rivede lo stesso banner
  -- venti volte in un minuto. Sessanta resta il soffitto della campagna, come prima.
  IF NOT public.sponsored_sotto_tetto(p_id, 'impression', 20, 60) THEN
    RETURN;
  END IF;
  UPDATE public.sponsored_listings SET impressions = impressions + 1
   WHERE id = p_id AND status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION public.track_sponsored_click(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- tre clic al minuto a testa sullo stesso annuncio: sopra e' un copione, non una persona.
  IF NOT public.sponsored_sotto_tetto(p_id, 'click', 3, 10) THEN
    RETURN;
  END IF;
  UPDATE public.sponsored_listings SET clicks = clicks + 1
   WHERE id = p_id AND status = 'active';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sponsored_sotto_tetto(uuid, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.track_sponsored_impression(uuid) TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.track_sponsored_click(uuid)      TO anon, authenticated;

-- =========================================================
-- ④ PERCHE' LE ALTRE RESTANO APERTE — scritto nel database, non solo qui
-- =========================================================
-- Queste quattro sono dentro le regole di lettura: chiuderle spegne la vetrina (provato sopra).
COMMENT ON FUNCTION public.is_admin() IS
  'Aperta ad anon di proposito: 28 regole di lettura la richiamano, fra cui products. Revocarla da errore su tutto il catalogo pubblico.';
COMMENT ON FUNCTION public.negozio_approvato(uuid) IS
  'Aperta ad anon di proposito: le regole di lettura di products e store_reviews la richiamano. Revocarla spegne il catalogo a chi non ha l''account.';
COMMENT ON FUNCTION public.prodotto_in_vetrina(uuid) IS
  'Aperta ad anon di proposito: le regole di lettura di reviews e product_variants la richiamano.';
COMMENT ON FUNCTION public.is_rider_approvato() IS
  'Aperta ad anon di proposito: la regola di lettura di orders la richiama. Risponde solo su chi chiama, nessuna riga esce.';

NOTIFY pgrst, 'reload schema';

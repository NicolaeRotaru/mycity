-- =============================================================================
-- 135 — LE PROVE CHE TENIAMO DI UNA PERSONA HANNO UNA SCADENZA, E FUNZIONA
-- =============================================================================
-- 27/8/2026 (R056, R058, R066).
--
-- Tre regole di conservazione erano scritte e non applicate. Una funzione che
-- dice di cancellare e non cancella e' peggio di una funzione che non c'e':
-- chi legge il commento smette di cercare il problema.
--
-- =========================================================
-- R056 — I DOCUMENTI DI CHI E' STATO RESPINTO
-- =========================================================
-- La migrazione 119 ha scritto: «la funzione azzera i riferimenti e
-- restituisce i percorsi dei file, che il cron cancella dallo storage». Era
-- dichiarata `LANGUAGE sql STABLE`: un SELECT, cioe' un elenco, che non azzera
-- niente. E non la chiamava nessuno. Risultato: carta d'identita', selfie,
-- patente, polizza e attestato HACCP di ogni venditore e fattorino RESPINTO
-- restavano nel profilo e nel secchio `kyc-docs` senza nessuna scadenza.
--
-- Chi e' stato respinto non e' un cliente: con lui un rapporto non e' mai
-- nato, quindi i dieci anni «dalla cessazione del rapporto» dichiarati
-- nell'informativa non lo riguardano nemmeno. Novanta giorni sono il tempo per
-- rimandare le carte giuste dopo un rifiuto; dopo, non c'e' piu' motivo.
--
-- Adesso la funzione fa quello che il suo commento diceva: azzera le sei
-- colonne UNA RIGA ALLA VOLTA e restituisce i percorsi vecchi, perche' il
-- database non puo' parlare con lo storage e i file li toglie il lavoro
-- notturno (app/api/cron/process-deletions).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.documenti_da_cancellare_respinti(p_giorni int DEFAULT 90)
RETURNS TABLE (user_id uuid, percorsi text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.id AS profilo,
           array_remove(ARRAY[
             p.kyc_id_doc_front_url, p.kyc_id_doc_back_url, p.kyc_selfie_url,
             p.rider_license_url, p.rider_insurance_url, p.rider_haccp_url
           ], NULL) AS file
      FROM public.profiles p
     WHERE p.approval_status = 'rejected'
       AND p.approved_at IS NOT NULL
       AND p.approved_at < now() - make_interval(days => greatest(p_giorni, 1))
       AND coalesce(p.kyc_id_doc_front_url, p.kyc_id_doc_back_url, p.kyc_selfie_url,
             p.rider_license_url, p.rider_insurance_url, p.rider_haccp_url) IS NOT NULL
  LOOP
    UPDATE public.profiles
       SET kyc_id_doc_front_url = NULL,
           kyc_id_doc_back_url  = NULL,
           kyc_selfie_url       = NULL,
           rider_license_url    = NULL,
           rider_insurance_url  = NULL,
           rider_haccp_url      = NULL
     WHERE id = r.profilo;
    user_id  := r.profilo;
    percorsi := r.file;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- In PostgreSQL una funzione nasce con EXECUTE concesso a PUBLIC: togliere il
-- permesso ad `anon` e `authenticated` non toglie niente, perche' quel permesso
-- non ce l'avevano in proprio. Va tolto a PUBLIC, o la porta resta aperta.
REVOKE EXECUTE ON FUNCTION public.documenti_da_cancellare_respinti(int) FROM PUBLIC, anon, authenticated;

-- =========================================================
-- R058 — LE FOTO DELLA PORTA DI CASA DEL CLIENTE
-- =========================================================
-- Alla consegna in contanti il fattorino carica due fotografie: i contanti e
-- «il pacco lasciato», che nella pratica e' l'ingresso dell'abitazione del
-- cliente. Piu' la firma. Finiscono nel secchio privato `cod-proof`, nella
-- cartella del FATTORINO — non in quella del cliente.
--
-- Da li' nascevano due guai. Il primo: quando il cliente cancellava l'account,
-- la pulizia cercava i suoi file nella SUA cartella e non trovava niente, cosi'
-- la foto di casa sua restava. Il secondo: nessuna potatura, per nessuno, mai.
--
-- Al fattorino quella foto serve finche' la cassa non e' quadrata e finche' un
-- reclamo puo' arrivare: novanta giorni dalla consegna sono larghi per
-- entrambe le cose. Dopo, e' solo la fotografia di una porta di casa.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.foto_consegna_da_cancellare(p_giorni int DEFAULT 90)
RETURNS TABLE (order_id uuid, percorsi text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT o.id AS ordine,
           array_remove(ARRAY[
             o.cash_photo_url, o.delivery_photo_url, o.cash_signature_url
           ], NULL) AS file
      FROM public.orders o
     WHERE coalesce(o.delivered_at, o.cash_confirmed_at) IS NOT NULL
       AND coalesce(o.delivered_at, o.cash_confirmed_at)
             < now() - make_interval(days => greatest(p_giorni, 1))
       AND coalesce(o.cash_photo_url, o.delivery_photo_url, o.cash_signature_url) IS NOT NULL
  LOOP
    UPDATE public.orders
       SET cash_photo_url     = NULL,
           delivery_photo_url = NULL,
           cash_signature_url = NULL
     WHERE id = r.ordine;
    order_id := r.ordine;
    percorsi := r.file;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.foto_consegna_da_cancellare(int) FROM PUBLIC, anon, authenticated;

-- =========================================================
-- R066 — IL REGISTRO DEI CONSENSI: UN NUMERO SOLO
-- =========================================================
-- La regola era scritta in due posti con due numeri diversi: questa funzione
-- diceva 12 mesi e non la chiamava nessuno, il lavoro notturno ne applicava 24
-- con una riga scritta a mano. Due verita' sulla stessa cosa: alla prossima
-- modifica una delle due sarebbe rimasta indietro, e la pagina pubblica
-- avrebbe smesso di dire il vero.
--
-- Adesso il numero vive qui e basta — 24 mesi, quello che il sito applica
-- davvero e che l'informativa dichiara — e la funzione toglie tutti e due i
-- dati che identificano chi ha dato il consenso: l'indirizzo di rete e il
-- programma di navigazione. La PROVA del consenso resta: e' l'accountability
-- dell'art. 7.1, ed e' l'unica cosa che serve conservare.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pota_consent_log(p_mesi int DEFAULT 24)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ripulite int;
BEGIN
  UPDATE public.consent_log
     SET ip = NULL, user_agent = NULL
   WHERE (ip IS NOT NULL OR user_agent IS NOT NULL)
     AND created_at < now() - make_interval(months => greatest(p_mesi, 1));
  GET DIAGNOSTICS ripulite = ROW_COUNT;
  RETURN ripulite;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pota_consent_log(int) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

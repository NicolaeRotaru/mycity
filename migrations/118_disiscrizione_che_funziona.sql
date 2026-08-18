-- =============================================================================
-- 118 — La disiscrizione con un clic deve davvero disiscrivere
-- =============================================================================
-- Il difetto, trovato dalla radiografia del 18/8 e verificato sul database di
-- produzione: la rotta /api/unsubscribe faceva
--
--     admin.from('profiles').update({...}).eq('email', dati.email)
--
-- ma `public.profiles` NON HA una colonna `email`. Le email stanno in
-- `auth.users`. PostgREST rifiuta la richiesta con 42703 (undefined_column), e
-- il codice non guardava l'esito: l'operazione falliva in silenzio.
--
-- Chi clicca «Cancellami» quindi non veniva tolto da niente, e continuava a
-- ricevere le email. Alla seconda o terza volta segna il messaggio come spam —
-- e da lì in avanti anche le conferme d'ordine rischiano la posta indesiderata
-- per TUTTI, perché la reputazione del mittente è una sola.
--
-- La riparazione mette il collegamento email→profilo dove le due cose vivono
-- insieme, cioè nel database. La rotta chiama una funzione e ne legge il
-- risultato, invece di sperare.
--
-- Prova: tests/unit/disiscrizione-con-un-clic.test.ts (il caso «tocca il
-- profilo giusto partendo dall'email» è rosso senza questa migrazione).
-- Idempotente.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.disiscrivi(p_email text, p_ambito text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  email_pulita text := lower(trim(coalesce(p_email, '')));
  uid uuid;
  righe_newsletter int := 0;
  righe_profilo int := 0;
BEGIN
  IF email_pulita = '' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'email vuota');
  END IF;

  -- L'ambito «newsletter» spegne anche l'iscrizione alla lista; «marketing»
  -- tocca solo il profilo. In entrambi i casi le email commerciali legate al
  -- profilo si fermano: chi chiede di smettere smette.
  IF p_ambito = 'newsletter' THEN
    UPDATE public.newsletter_subscribers
       SET active = false, unsubscribed_at = now()
     WHERE lower(email) = email_pulita;
    GET DIAGNOSTICS righe_newsletter = ROW_COUNT;
  END IF;

  -- Il collegamento che mancava: l'email sta in auth.users, non in profiles.
  SELECT id INTO uid FROM auth.users WHERE lower(email) = email_pulita LIMIT 1;

  IF uid IS NOT NULL THEN
    UPDATE public.profiles
       SET email_marketing = false, notif_promos = false
     WHERE id = uid;
    GET DIAGNOSTICS righe_profilo = ROW_COUNT;
  END IF;

  -- «ok» vuol dire che qualcosa è stato spento davvero. Se non risulta né in
  -- lista né fra gli account, chi chiama lo deve sapere invece di mostrare
  -- «fatto» a una persona che continuerà a ricevere le email.
  RETURN jsonb_build_object(
    'ok', (righe_newsletter + righe_profilo) > 0,
    'newsletter', righe_newsletter,
    'profilo', righe_profilo
  );
END;
$$;

-- La chiama solo il server, dalla rotta con la chiave di servizio: il token
-- firmato è già la prova che quell'indirizzo ha chiesto di smettere, ma la
-- funzione tocca il profilo di un altro e non deve stare in mano al browser.
REVOKE EXECUTE ON FUNCTION public.disiscrivi(text, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.disiscrivi(text, text) TO service_role;

-- =============================================================================
-- 118b — Due cose lasciate a metà dalla 115, segnalate dal controllo di Supabase
-- =============================================================================

-- ① `activity_key_sensibile` non dichiarava il proprio percorso di ricerca.
-- La funzione non legge nessuna tabella (è un confronto di testo), quindi il
-- rischio è piccolo, ma l'operatore `~*` si risolve comunque via search_path:
-- meglio inchiodarlo, come in tutte le altre funzioni di questo schema.
CREATE OR REPLACE FUNCTION public.activity_key_sensibile(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT p_key ~* '(password|token|secret|iban|bic|swift|card|cvv|fiscal|tax|vat|piva|birth|resid|phone|mobile|tel|address|indirizz|email|mail|sdi|pec|kyc|selfie|licen|document|doc_|signature|firma|lat|lng|zip|cap$|full_name|nome|cognome|note)';
$$;

-- ② Le tre viste nuove risultano «definer» al controllo di Supabase, e ci
-- restano APPOSTA. Non è una svista: la 114 ha tolto la lettura pubblica dalle
-- tabelle sotto (sponsored_listings, orders, profiles). Se queste viste
-- girassero coi permessi di chi le legge, il visitatore senza account non
-- vedrebbe più niente e le tre funzioni per cui esistono resterebbero vuote:
-- la vetrina «dal vivo» in home, il carosello degli sponsorizzati e il nome di
-- battesimo dell'autore nelle recensioni del fattorino.
--
-- Il conto è questo: la vista è la superficie ristretta che sostituisce la
-- lettura diretta della tabella. Espone SOLO le colonne scelte — nessun dato
-- personale del cliente, nessun dato economico del negozio — e quella del
-- fattorino filtra da sé su chi la chiama. Il commento resta qui perché la
-- prossima radiografia trovi la ragione scritta, invece di risegnalarle.
COMMENT ON VIEW public.sponsored_active_public IS
  'Annunci sponsorizzati attivi, senza i dati economici. Gira coi permessi del proprietario APPOSTA: la 114 ha tolto la lettura pubblica di sponsored_listings, e senza questo il carosello resta vuoto. @foreignKey (product_id) references public.products (id)';

COMMENT ON VIEW public.live_activity_public IS
  'Attivita recente per la home: citta, stato, negozio. Nessun dato personale del cliente. Gira coi permessi del proprietario APPOSTA: senza, il visitatore senza account non vede nessun ordine e la vetrina dal vivo resta vuota.';

COMMENT ON VIEW public.rider_reviews_ricevute IS
  'Recensioni del fattorino che chiama, col solo nome di battesimo dell''autore. Gira coi permessi del proprietario APPOSTA: la 115 ha tolto al fattorino la lettura del profilo del cliente, e il filtro su chi chiama sta gia dentro la vista.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 155_il_registro_attivita_oscura_per_difetto.sql
--
-- IL REGISTRO SI COPIAVA IL COGNOME LEGALE DI NEGOZIANTI E FATTORINI.
--
-- Il trigger `log_activity_change` (installato su profiles, orders,
-- order_items, gift_cards, returns e altre sette tabelle) scrive in
-- `activity_events.metadata.changed` il valore VECCHIO e quello NUOVO di ogni
-- colonna cambiata, e oscura solo quelle il cui NOME somiglia a una lista
-- scritta a mano. La lista aveva `full_name`, `nome`, `cognome` — e non aveva
-- `first_name` ne' `last_name`.
--
-- Cosa si e' visto sul database ricostruito dalle migrazioni: dopo
--   UPDATE profiles SET legal_first_name='Mario', legal_last_name='Rossi'
-- la riga `profiles.update` del registro contiene
--   {"changed": {"legal_last_name": {"new": "Rossi"}, "legal_first_name": {"new": "Mario"}}}
-- e ci resta quattordici mesi — anche dopo la cancellazione dell'account: il
-- profilo sparisce, la copia dentro il diff no. Stessa sorte per
-- `gift_cards.recipient_name`, per `gift_cards.message` (il testo privato che
-- una persona scrive a un'altra) e per `rider_haccp_url` /
-- `rider_insurance_url`.
--
-- Non e' esposto al pubblico (la tabella ha RLS: solo amministratori e chiave di
-- servizio), ma e' una violazione di minimizzazione e del diritto alla
-- cancellazione che salta fuori al primo controllo.
--
-- ── PERCHE' NON BASTA ALLUNGARE LA LISTA ──
--
-- Il difetto non e' che mancavano tre parole: e' il VERSO della regola. Con un
-- elenco di cose da nascondere, ogni colonna nuova nasce in chiaro e non se ne
-- accorge nessuno. Qui la regola si rovescia: il valore si vede SOLO se la
-- chiave sta in un elenco chiuso (stati, prezzi, quantita', bandierine, date,
-- identificativi). Tutto il resto esce `***`. La chiave resta visibile — si
-- vede sempre CHE COSA e' cambiato — sparisce il valore.
--
-- Il secondo pezzo e' il veto: l'elenco chiuso e' fatto di FORME (`*_id`,
-- `*_at`), e una forma puo' far passare per sbaglio un dato personale
-- (`tax_id`, `birth_at`). La vecchia lista di parole resta e vieta comunque.
--
-- Le due espressioni sono la copia di quelle in `lib/privacy/colonne-personali.ts`,
-- e la prova `tests/unit/il-registro-attivita-non-copia-il-cognome-legale.test.ts`
-- le rilegge DA QUESTO FILE, le esegue su un elenco di colonne vere e fallisce
-- se le due copie divergono.
--
-- Il trigger non si tocca: continua a chiamare questa funzione come prima
-- (`IF v_key = ANY(v_redact) OR public.activity_key_sensibile(v_key)`).
--
-- Non tocca nessuna riga gia' scritta: vale da adesso in avanti. Le righe
-- vecchie se ne vanno da sole con la potatura dei 14 mesi
-- (`app/api/cron/process-deletions`, potatura `activity_events.riassunto`).
--
-- Idempotente: e' un CREATE OR REPLACE.
--
-- ROLLBACK (rimette in piedi la regola della 118, parola per parola):
--   CREATE OR REPLACE FUNCTION public.activity_key_sensibile(p_key text)
--   RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog
--   AS $ROLLBACK$
--     SELECT p_key ~* '(password|token|secret|iban|bic|swift|card|cvv|fiscal|tax|vat|piva|birth|resid|phone|mobile|tel|address|indirizz|email|mail|sdi|pec|kyc|selfie|licen|document|doc_|signature|firma|lat|lng|zip|cap$|full_name|nome|cognome|note)';
--   $ROLLBACK$;
--   NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.activity_key_sensibile(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  -- ① fuori dall'elenco chiuso delle colonne che un registro puo' mostrare
  SELECT NOT (p_key ~* '^(id|status|state|stato|role|ruolo|type|tipo|kind|slug|locale|lang|currency|valuta|category|categoria|source|channel|canale|method|provider|version|position|sort_order|priority|step|quantity|qty|qta|amount|price|prezzo|total|subtotal|discount|sconto|percent|percentuale|rating|stars|score|active|approved|enabled|visible|published|stock|sku|weight|unit|size|color|colore|archived|deleted|expired|is_[a-z0-9_]+|has_[a-z0-9_]+|can_[a-z0-9_]+|[a-z0-9_]*_id|[a-z0-9_]*_at|[a-z0-9_]*_cents|[a-z0-9_]*_count|[a-z0-9_]*_qty|[a-z0-9_]*_status|[a-z0-9_]*_state)$')
  -- ② oppure dentro il veto: somiglia comunque a un dato personale
      OR (p_key ~* '(password|token|secret|iban|bic|swift|card|cvv|fiscal|tax|vat|piva|birth|resid|phone|mobile|tel|address|indirizz|email|mail|sdi|pec|kyc|selfie|licen|document|doc_|signature|firma|(^|_)(lat|latitud|lng|longitud)($|_)|zip|cap$|full_name|nome|cognome|note|first_name|last_name|recipient|message|messaggio|haccp|insurance|assicur|photo)');
$$;

COMMENT ON FUNCTION public.activity_key_sensibile(text) IS
  'Vero se il VALORE di questa colonna non va copiato nel registro attivita''. Elenco chiuso di cio'' che si puo'' mostrare, piu'' un veto per somiglianza: una colonna nuova nasce oscurata.';

NOTIFY pgrst, 'reload schema';

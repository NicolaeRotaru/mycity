-- Ogni attività può iscriversi, e trova il suo preventivo già pronto.
--
-- LA RICHIESTA. Nicola, 22/11/2026: «quando l'imprenditore si iscrive, non è più obbligatorio
-- essere per forza una bottega». Ha aperto un'agenzia con un videomaker e un fotografo, e vuole
-- far entrare bar, ristoranti e qualunque attività venda qualcosa. La dashboard di ogni attività
-- mostra cosa le manca (logo, foto del locale, foto dei prodotti, video) con il preventivo
-- dell'agenzia già pronto.
--
-- COSA CAMBIA NEL DATABASE. Tre colonne, nessuna tabella nuova:
--  · profiles.business_type — che attività è. Gli stessi codici di lib/agenzia/tipi-attivita.ts
--    (il test tests/unit/ogni-attivita-puo-iscriversi.test.ts controlla che coincidano). NULL
--    vuol dire «iscritto prima del 22/11», cioè un negozio: il sito lo legge così.
--  · profiles.business_type_detail — le parole del negoziante quando sceglie «altro»
--    (massimo 60 caratteri, come nel modulo).
--  · site_settings.agenzia — il nome dell'agenzia e i prezzi dei servizi, in centesimi, per
--    cambiarli senza rifare il sito (come branding e home_site, 075). Vuota vuol dire: valgono
--    la firma MyCity e il listino di Nicola del 22/11 scritti in lib/agenzia/preventivo.ts
--    (sito 500 €, social 300 € al mese, foto e video da 50 a 300 € al mese, logo su richiesta).
--
-- I PERMESSI NON CAMBIANO. La lettura di profiles e site_settings è già concessa a livello di
-- tabella (425): le colonne nuove seguono le regole di riga che ci sono. Il browser non può
-- scrivere business_type da solo: la guardia sui profili (119, ultima versione in 400) non lo ha nell'elenco
-- delle colonne che una persona cambia da sé. Lo scrive /api/seller/apply con la chiave di servizio.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- Va applicata PRIMA di pubblicare il codice; se arriva dopo, l'iscrizione regge lo stesso
-- (la rotta riprova senza il tipo) ma il tipo non si salva.
-- REVERSIBILE:
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS business_type_detail;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS business_type;
--   ALTER TABLE public.site_settings DROP COLUMN IF EXISTS agenzia;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_type text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_type_detail text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_business_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_business_type_check
  CHECK (business_type IS NULL OR business_type IN ('negozio', 'bar', 'ristorante', 'artigiano', 'servizi', 'altro'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_business_type_detail_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_business_type_detail_check
  CHECK (business_type_detail IS NULL OR char_length(business_type_detail) <= 60);

COMMENT ON COLUMN public.profiles.business_type IS
  'Che attività è (22/11/2026): negozio, bar, ristorante, artigiano, servizi, altro. NULL = iscritto prima, si legge come negozio. Elenco in lib/agenzia/tipi-attivita.ts.';
COMMENT ON COLUMN public.profiles.business_type_detail IS
  'Le parole del negoziante quando il tipo è «altro» (max 60 caratteri).';

ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS agenzia jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.site_settings.agenzia IS
  'Preventivo di MyCity, foto e video col partner scattiDG (22-23/11/2026). Esempio: {"nome": "MyCity", "prezzi": {"logo": null, "foto_video": {"da": 5000, "a": 30000}, "social": 30000, "sito_web": 50000}}. Chiavi dei prezzi: logo, foto_video, social, sito_web. Valori in centesimi: un numero = prezzo fisso, {"da","a"} = fascia, null = su richiesta, chiave assente = listino di lib/agenzia/preventivo.ts. Lo 0 non vale come prezzo: si legge «su richiesta».';

NOTIFY pgrst, 'reload schema';

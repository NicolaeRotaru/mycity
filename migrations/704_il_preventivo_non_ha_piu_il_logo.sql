-- 704 — Il preventivo non ha più la voce «Logo e grafica» e ha la «Scheda Google su Maps» (Nicola, 23/11/2026: «togli sezione
-- di logo e grafica»). Cambia solo il commento della colonna: una chiave "logo" rimasta
-- scritta in site_settings.agenzia.prezzi viene ignorata dal sito, non rompe niente.

COMMENT ON COLUMN public.site_settings.agenzia IS
  'Preventivo di MyCity, foto e video col partner scattiDG (22-23/11/2026). Esempio: {"nome": "MyCity", "prezzi": {"foto_video": {"da": 5000, "a": 30000}, "social": 30000, "sito_web": 50000, "google_maps": null}}. Chiavi dei prezzi: foto_video, social, sito_web, google_maps (il logo è stato tolto il 23/11/2026). Valori in centesimi: un numero = prezzo fisso, {"da","a"} = fascia, null = su richiesta, chiave assente = listino di lib/agenzia/preventivo.ts. Lo 0 non vale come prezzo: si legge «su richiesta».';

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 865 — Gli agenti entrano solo dal link d'invito
-- =============================================================================
-- CHE COSA. Nicola, 26/11/2026: «non ci deve essere da nessuna parte il modo di iscriversi come venditore
-- dentro MyCity … quando io creo un link dentro admin … solo chi ha quel link lì può iscriversi». Chi visita i
-- negozi per proporre i servizi di SDG (in MyCity «venditore» vuol già dire «negozio»: qui si chiama AGENTE)
-- entra con un link creato da Admin → Agenti. Col link crea il suo account MyCity (email e password) e apre
-- la pagina /agente: incolla il link di Google Maps di un'attività, preme «Analizza», legge la scheda del
-- cliente (motore: flussi n8n 14 e 14b con «90 · Chiedi all'AD»).
--
-- DUE TABELLE, SOLO DAL SERVER (come preventivi_con_codice, 708, e schede_clienti, 864):
--   · inviti_agente — i link d'invito. Si tiene l'IMPRONTA del codice (sha256), mai il codice: chi leggesse la
--     tabella non avrebbe un link valido. Ogni link vale per `usi_max` persone (di serie 1) fino a `scade_il`;
--     Admin lo può ritirare (`ritirato_il`). Niente si cancella: un link usato o ritirato resta, con la data.
--   · agenti — chi è agente: l'utente, l'email con cui si è iscritto, da quale invito, e se è attivo.
--     Sospendere un agente = `attivo = false` (resta la riga, con `sospeso_il`).
-- L'agente NON cambia ruolo: resta un account MyCity come gli altri (profiles.role non si tocca, e con lui
-- nessuna delle regole sui ruoli). Essere agente vuol dire avere una riga attiva qui.
--
-- Nessuna regola per il browser: anon e authenticated non leggono e non scrivono niente. Le rotte del sito
-- (/api/agente/*, /api/admin/agenti, /api/invito-agente/*) usano la chiave di servizio.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: DROP TABLE public.agenti; DROP TABLE public.inviti_agente;  (prima archiviare le righe)
-- LA PROVA: tests/sql/rls/gli-agenti-entrano-solo-dal-link.test.sql.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.inviti_agente (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codice_hash  text NOT NULL UNIQUE CHECK (codice_hash ~ '^[0-9a-f]{64}$'),
  nota         text CHECK (nota IS NULL OR char_length(nota) <= 120),
  creato_da    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  creato_il    timestamptz NOT NULL DEFAULT now(),
  scade_il     timestamptz NOT NULL,
  usi_max      integer NOT NULL DEFAULT 1 CHECK (usi_max BETWEEN 1 AND 50),
  usi          integer NOT NULL DEFAULT 0 CHECK (usi >= 0),
  ritirato_il  timestamptz,
  CONSTRAINT inviti_agente_usi_nel_tetto CHECK (usi <= usi_max),
  CONSTRAINT inviti_agente_scade_dopo CHECK (scade_il > creato_il)
);

CREATE TABLE IF NOT EXISTS public.agenti (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email        text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  invito_id    uuid REFERENCES public.inviti_agente(id) ON DELETE SET NULL,
  attivo       boolean NOT NULL DEFAULT true,
  creato_il    timestamptz NOT NULL DEFAULT now(),
  sospeso_il   timestamptz
);

CREATE INDEX IF NOT EXISTS inviti_agente_creato_il_idx ON public.inviti_agente (creato_il DESC);
CREATE INDEX IF NOT EXISTS agenti_creato_il_idx ON public.agenti (creato_il DESC);
-- Ogni chiave esterna ha il suo indice (prova 14, «le porte di servizio sono chiuse»).
CREATE INDEX IF NOT EXISTS agenti_invito_id_idx ON public.agenti (invito_id);
CREATE INDEX IF NOT EXISTS inviti_agente_creato_da_idx ON public.inviti_agente (creato_da);

/**
 * Usa un invito in modo atomico: una sola riga, solo se valido (non ritirato, non scaduto, usi sotto il tetto).
 * Due persone che aprono lo stesso link monouso nello stesso istante: entra una sola. Restituisce l'id
 * dell'invito usato, o NULL. La chiama solo il server (chiave di servizio).
 */
CREATE OR REPLACE FUNCTION public.usa_invito_agente(p_codice_hash text)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.inviti_agente
     SET usi = usi + 1
   WHERE codice_hash = p_codice_hash
     AND ritirato_il IS NULL
     AND scade_il > now()
     AND usi < usi_max
  RETURNING id;
$$;

ALTER TABLE public.inviti_agente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenti ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inviti_agente FROM anon, authenticated;
REVOKE ALL ON public.agenti FROM anon, authenticated;
GRANT ALL ON public.inviti_agente TO service_role;
GRANT ALL ON public.agenti TO service_role;

REVOKE ALL ON FUNCTION public.usa_invito_agente(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usa_invito_agente(text) TO service_role;

COMMENT ON TABLE public.inviti_agente IS
  'I link d invito degli agenti (chi visita i negozi per i servizi SDG): impronta sha256 del codice, mai il codice; monouso e con scadenza di serie. Solo dal server (migrazione 865).';
COMMENT ON TABLE public.agenti IS
  'Chi è agente: account MyCity entrato da un link d invito di Admin. attivo=false = sospeso. Solo dal server (migrazione 865).';

COMMIT;

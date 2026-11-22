-- 660_la_memoria_degli_allarmi_si_pulisce_da_sola.sql
--
-- R04-001 (21/11/2026) — LA MEMORIA DEGLI ALLARMI NON SI PULIVA MAI.
--
-- `operational_alert_log` (migrazione 084) ricorda quando un avviso e' partito, per non
-- rimandarlo entro la sua attesa. Nessuno cancellava le righe vecchie: ogni allarme legato a
-- un ordine lasciava due righe per sempre (la chiave dell'email e CAMPANELLA|…), e la tabella
-- cresceva senza fine.
--
-- QUANTO SI TIENE. L'attesa piu' lunga che il sito legge in questa memoria e' di 24 ore:
--   · app/api/cron/operational-alerts/route.ts  COOLDOWN_HOURS = 6, ATTESA_DI_UN_GIORNO_ORE = 24
--   · app/api/cron/expire-checkouts/route.ts    ORE_SILENZIO_CARRELLO = 24
--   · app/api/cron/release-payouts/route.ts     ORE_SILENZIO_AVVISO = 6
--   · app/api/rider/sos/avvisa/route.ts         FINESTRA_SOS_MS = 10 minuti (un SOS piu' vecchio
--                                               non si cerca nemmeno)
-- Ogni lettura guarda solo le righe con last_sent_at piu' recente della sua attesa, e il turno
-- (`prendiIlTurno`) tratta una riga piu' vecchia di sei ore come una che si puo' riprendere.
-- Una riga piu' vecchia di 24 ore non ferma piu' nessun avviso: toglierla non cambia niente di
-- quello che parte. Se un giorno un'attesa si allunga oltre le 24 ore, va allungato anche qui.
--
-- LA RIGA CHE NON SI TOGLIE. `ai-tetto-condiviso:ripiego-da` (lib/ai/tettoSpesa.ts,
-- CHIAVE_RIPIEGO_DA) non e' un invio: e' l'ora in cui il conto condiviso ha smesso di
-- rispondere, scritta una volta sola e tolta quando torna. Resta finche' il guasto dura.
--
-- CHI PULISCE. Il deposito non usa pg_cron, e una pulizia che aspetta qualcuno che la chiami
-- non parte da sola. Pulisce la scrittura stessa: dopo ogni INSERT o UPDATE sulla tabella
-- (cioe' a ogni giro che ricorda un avviso) si tolgono le righe piu' vecchie di 24 ore. Le
-- righe che un altro giro sta toccando in quello stesso momento si saltano (SKIP LOCKED):
-- nessuna attesa incrociata fra due giri, e le saltate le toglie la scrittura dopo.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.operational_alert_log_toglie_le_vecchie()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.operational_alert_log
   WHERE alert_key IN (
     SELECT v.alert_key
       FROM public.operational_alert_log v
      WHERE v.last_sent_at < now() - interval '24 hours'
        AND v.alert_key <> 'ai-tetto-condiviso:ripiego-da'
        FOR UPDATE SKIP LOCKED
   );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.operational_alert_log_toglie_le_vecchie() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS operational_alert_log_toglie_le_vecchie ON public.operational_alert_log;
CREATE TRIGGER operational_alert_log_toglie_le_vecchie
  AFTER INSERT OR UPDATE ON public.operational_alert_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.operational_alert_log_toglie_le_vecchie();

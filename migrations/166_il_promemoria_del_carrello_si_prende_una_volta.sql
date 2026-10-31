-- 166_il_promemoria_del_carrello_si_prende_una_volta.sql
--
-- 31/10/2026 — DUE GIRI INSIEME, DUE PROMEMORIA ALLA STESSA PERSONA.
--
-- Il giro orario dei carrelli abbandonati (app/api/cron/abandoned-carts) prima
-- di spedire «rivendica» il carrello con `mark_abandoned_cart_email_sent`.
-- Ma la funzione (migrazione 029) scriveva il segno senza guardare se c'era
-- gia', e non restituiva niente: il giro poteva guardare solo l'errore. Due
-- giri partiti alla stessa ora (vercel.json e cron-job.org, tutti e due alle
-- :00) leggevano lo stesso carrello, lo rivendicavano tutti e due con
-- successo e spedivano due volte. Chi riceve due volte lo stesso messaggio lo
-- segna come spam, e da li' finisce nello spam la posta di tutti.
--
-- Adesso il segno si scrive solo se non c'era, e la funzione risponde se l'ha
-- scritto lei. Il secondo giro, che arriva dopo, aspetta il blocco della riga,
-- rilegge la condizione e trova il segno gia' messo: risponde falso, e il giro
-- non spedisce.
--
-- Cambia il tipo restituito (da niente a vero/falso): per questo si toglie e si
-- ricrea, e si richiudono i permessi come nelle 059/064. Il giro vecchio, che
-- ignora la risposta, continua a funzionare uguale.
--
-- Idempotente: si puo' rieseguire.

DROP FUNCTION IF EXISTS public.mark_abandoned_cart_email_sent(uuid);
CREATE OR REPLACE FUNCTION public.mark_abandoned_cart_email_sent(p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    WITH segnati AS (
        UPDATE public.abandoned_carts
        SET recovery_email_sent_at = now()
        WHERE user_id = p_user
          AND recovery_email_sent_at IS NULL
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM segnati);
$$;

REVOKE EXECUTE ON FUNCTION public.mark_abandoned_cart_email_sent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_cart_email_sent(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

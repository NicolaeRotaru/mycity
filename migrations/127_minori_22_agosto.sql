-- ============================================================================
-- 127 — I difetti minori della radiografia del 21 agosto, lato database.
--
-- Ogni blocco è idempotente: si può riapplicare senza fare danni.
-- ============================================================================

-- ── ① Due guardiani identici sulla stessa tabella ───────────────────────────
--
-- La migrazione 061 aveva creato `trg_enforce_profile_update` su
-- `public.profiles`. La 119 ha riscritto la funzione e creato un trigger con un
-- nome NUOVO, `trg_enforce_profile_update_rules`, ma ha fatto il DROP solo del
-- nome nuovo. Risultato: due trigger BEFORE UPDATE sulla stessa tabella che
-- chiamano la stessa funzione, quindi la regola gira due volte a ogni
-- salvataggio di un profilo.
--
-- Non è un buco di sicurezza — la regola è la stessa, e applicarla due volte dà
-- lo stesso esito. È lavoro pagato due volte su una tabella che si scrive
-- spesso, ed è soprattutto una trappola: chi domani cambia la regola e cerca
-- «il trigger» ne trova due, e non sa quale sta guardando.
DROP TRIGGER IF EXISTS trg_enforce_profile_update ON public.profiles;

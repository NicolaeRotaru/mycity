-- =============================================================================
-- R14-021 — L'esito di una segnalazione si comunica una volta per canale
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere (385 compresa).
--
-- Il contratto: i segni dei tre canali (email, notifica, venditore) si prendono con
-- un UPDATE condizionato che solo una chiamata vince; una decisione cambiata azzera i
-- segni (l'esito nuovo va comunicato di nuovo); un UPDATE che non cambia la decisione
-- non li tocca. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1402100-0000-0000-0000-000000000001', 'segnala-r14-021@test.it', '{"role":"buyer"}');

INSERT INTO public.segnalazioni (id, tipo, oggetto_id, motivo, segnalante_id, email_contatto, stato, esito_motivato)
VALUES ('e1402100-0000-0000-0000-0000000000a1', 'negozio', 'e1402100-0000-0000-0000-0000000000b1',
        'altro', 'e1402100-0000-0000-0000-000000000001', 'chi@segnala.it', 'accolta',
        'Il negozio vende merce non consentita dal regolamento.');

DO $$
DECLARE primo int; secondo int; v record;
BEGIN
  UPDATE public.segnalazioni SET esito_email_at = now()
   WHERE id = 'e1402100-0000-0000-0000-0000000000a1' AND esito_email_at IS NULL;
  GET DIAGNOSTICS primo = ROW_COUNT;
  UPDATE public.segnalazioni SET esito_email_at = now()
   WHERE id = 'e1402100-0000-0000-0000-0000000000a1' AND esito_email_at IS NULL;
  GET DIAGNOSTICS secondo = ROW_COUNT;
  INSERT INTO esiti VALUES ('① il canale lo prende una chiamata sola', primo = 1 AND secondo = 0,
                            format('prima %s righe, seconda %s', primo, secondo));

  UPDATE public.segnalazioni SET esito_notifica_at = now(), esito_venditore_at = now()
   WHERE id = 'e1402100-0000-0000-0000-0000000000a1';
  -- non cambia la decisione: i segni restano
  UPDATE public.segnalazioni SET deciso_at = now() WHERE id = 'e1402100-0000-0000-0000-0000000000a1';
  SELECT * INTO v FROM public.segnalazioni WHERE id = 'e1402100-0000-0000-0000-0000000000a1';
  INSERT INTO esiti VALUES ('② un UPDATE che non cambia la decisione lascia i segni',
                            v.esito_email_at IS NOT NULL AND v.esito_notifica_at IS NOT NULL AND v.esito_venditore_at IS NOT NULL,
                            format('%s %s %s', v.esito_email_at IS NOT NULL, v.esito_notifica_at IS NOT NULL, v.esito_venditore_at IS NOT NULL));

  UPDATE public.segnalazioni SET stato = 'respinta',
         esito_motivato = 'Dopo un nuovo esame il negozio e in regola, la segnalazione non regge.'
   WHERE id = 'e1402100-0000-0000-0000-0000000000a1';
  SELECT * INTO v FROM public.segnalazioni WHERE id = 'e1402100-0000-0000-0000-0000000000a1';
  INSERT INTO esiti VALUES ('③ una decisione cambiata azzera i segni: l esito nuovo si comunica',
                            v.esito_email_at IS NULL AND v.esito_notifica_at IS NULL AND v.esito_venditore_at IS NULL,
                            format('%s %s %s', v.esito_email_at IS NULL, v.esito_notifica_at IS NULL, v.esito_venditore_at IS NULL));
END $$;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;

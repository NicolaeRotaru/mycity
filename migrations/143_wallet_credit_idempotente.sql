-- Il credito MyCity si accreditava due volte, e una migrazione giurava il contrario.
--
-- IL DIFETTO (radiografia del 27/8/2026, R132). La migrazione 126 scriveva, riga 113: «`wallet_credit`
-- ha una chiave (`p_ref`): con `order_canceled_<id>` un secondo annullo dello stesso ordine non
-- accredita due volte». Non era vero. `wallet_credit` chiamava `_wallet_apply` (087, righe 50-63), che
-- sommava il delta al saldo e scriveva la riga a diario senza guardare il `ref`. L'unica chiave che
-- esisteva davvero era parziale e copriva un motivo solo — il rimborso di un ordine in contanti
-- (098, riga 17). Tutti gli altri erano scoperti: l'annullo del cliente, il rifiuto del negozio,
-- l'annullo dell'amministratore, la scadenza automatica del cron.
--
-- Misurato sul database ricostruito dalle migrazioni: due chiamate a `wallet_credit` con la stessa
-- chiave `order_canceled_9f3a` lasciavano 3000 centesimi di saldo al posto di 1500, e due righe a
-- diario. Quel saldo si spende in cassa come denaro.
--
-- La cosa peggiore non era il difetto: era la frase. Chi scriveva il pezzo successivo leggeva «la
-- protezione c'e' gia'» e non ne metteva un'altra. Un commento che promette una garanzia inesistente
-- fa piu' danno del buco, perche' spegne il sospetto.
--
-- LA RIPARAZIONE. La riga a diario diventa la chiave, non la conseguenza: `_wallet_apply` la scrive
-- PRIMA di toccare il saldo, con `ON CONFLICT DO NOTHING`. Se quella coppia motivo+chiave c'e' gia',
-- l'inserimento non fa niente, il saldo non si muove e la funzione risponde «non ho fatto niente».
-- Due chiamate in parallelo si mettono in fila sull'indice unico: la seconda aspetta la prima e poi
-- trova la riga. Non e' un controllo «guarda se c'e' e poi scrivi», che tra il guarda e lo scrivi
-- lascia sempre una fessura.
--
-- PERCHE' LA CHIAVE ESCLUDE I PUNTI FEDELTA'. `convert_loyalty_to_credit` (087, riga 135) passa come
-- `ref` una descrizione, non un identificativo: `format('%s_pts', p_points)`, cioe' «100_pts». Due
-- clienti diversi che convertono cento punti a testa scrivono la stessa parola. Una chiave che
-- comprendesse anche quel motivo brucerebbe i punti del secondo senza dargli niente in cambio — e li'
-- il doppio giro e' corretto, perche' anche i punti vengono scalati due volte.
--
-- REVERSIBILE. `DROP INDEX public.wallet_ledger_chiave_idx;` e le tre funzioni si ricreano col testo
-- della 087, che e' ancora al suo posto.
--
-- LA PROVA: tests/sql/rls/24-il-credito-non-si-accredita-due-volte.test.sql. Senza questa migrazione
-- e' rossa su tre controlli, con questa e' verde.

-- =========================================================
-- ① I DOPPIONI GIA' IN CASA
-- =========================================================
-- Un accredito doppio del passato e' successo davvero: i soldi sono usciti, e cancellare la riga
-- falserebbe la quadratura del saldo. Quindi la riga resta e si toglie di mezzo dalla chiave, con un
-- marchio che dice cos'e'. Se ce ne sono, la migrazione lo grida nei log: sono soldi da guardare.
DO $$
DECLARE n int;
BEGIN
  WITH doppioni AS (
    SELECT id, row_number() OVER (PARTITION BY reason, ref ORDER BY created_at, id) AS posto
      FROM public.wallet_ledger
     WHERE ref IS NOT NULL AND reason <> 'loyalty_convert'
  )
  UPDATE public.wallet_ledger w
     SET ref = w.ref || '#doppione-' || left(w.id::text, 8)
    FROM doppioni d
   WHERE d.id = w.id AND d.posto > 1;
  GET DIAGNOSTICS n = ROW_COUNT;

  IF n > 0 THEN
    RAISE WARNING 'wallet_ledger: % righe erano accrediti/addebiti doppi sulla stessa chiave. Marchiate «#doppione-…», non cancellate. Da rivedere una per una: sono soldi.', n;
  END IF;
END $$;

-- =========================================================
-- ② LA CHIAVE
-- =========================================================
-- Non e' `CONCURRENTLY`: `wallet_ledger` e' una tabella piccola (una riga per movimento di credito) e
-- una creazione concorrente non si puo' mettere nella stessa transazione della bonifica qui sopra.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_chiave_idx
  ON public.wallet_ledger (reason, ref)
  WHERE ref IS NOT NULL AND reason <> 'loyalty_convert';

-- =========================================================
-- ③ IL MOVIMENTO SI SCRIVE UNA VOLTA SOLA
-- =========================================================
-- Restituisce il saldo nuovo, oppure NULL se non c'era niente da fare perche' quel movimento era
-- gia' registrato. NULL e' scomodo di proposito: obbliga chi chiama a decidere cosa rispondere, e
-- `wallet_debit` deve rispondere una cosa diversa da `wallet_credit`.
CREATE OR REPLACE FUNCTION public._wallet_apply(p_user uuid, p_delta int, p_reason text, p_ref text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new int; v_riga uuid;
BEGIN
  -- La riga del profilo si blocca per prima, sempre, anche quando arriva da
  -- `wallet_debit` che l'ha gia' bloccata: cosi' due movimenti sullo stesso
  -- cliente prendono i lucchetti nello stesso ordine e non si incastrano.
  SELECT wallet_balance_cents INTO v_new FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Utente inesistente'; END IF;

  INSERT INTO public.wallet_ledger (user_id, delta_cents, reason, ref)
    VALUES (p_user, p_delta, p_reason, p_ref)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_riga;
  IF v_riga IS NULL THEN RETURN NULL; END IF;  -- gia' fatto: il saldo non si tocca

  UPDATE public.profiles
    SET wallet_balance_cents = wallet_balance_cents + p_delta
    WHERE id = p_user
    RETURNING wallet_balance_cents INTO v_new;  -- il CHECK >= 0 impedisce saldi negativi
  RETURN v_new;
END; $$;

-- Lo storno: se il movimento c'era gia', il saldo di adesso e' la risposta giusta.
CREATE OR REPLACE FUNCTION public.wallet_credit(p_user uuid, p_cents int, p_reason text, p_ref text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new int;
BEGIN
  IF p_cents IS NULL OR p_cents <= 0 THEN RETURN 0; END IF;
  v_new := public._wallet_apply(p_user, p_cents, p_reason, p_ref);
  IF v_new IS NULL THEN
    SELECT wallet_balance_cents INTO v_new FROM public.profiles WHERE id = p_user;
  END IF;
  RETURN v_new;
END; $$;

-- La spesa: qui la risposta e' «quanto ho tolto davvero», e chi chiama la scala dal totale da pagare.
-- Se il movimento c'era gia', la risposta e' zero: non l'ho tolto io, e dirlo sarebbe far pagare meno.
CREATE OR REPLACE FUNCTION public.wallet_debit(p_user uuid, p_max_cents int, p_reason text, p_ref text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bal int; v_applied int; v_new int;
BEGIN
  IF p_max_cents IS NULL OR p_max_cents <= 0 THEN RETURN 0; END IF;
  SELECT wallet_balance_cents INTO v_bal FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF v_bal IS NULL THEN RETURN 0; END IF;
  v_applied := LEAST(v_bal, p_max_cents);
  IF v_applied <= 0 THEN RETURN 0; END IF;
  v_new := public._wallet_apply(p_user, -v_applied, p_reason, p_ref);
  IF v_new IS NULL THEN RETURN 0; END IF;
  RETURN v_applied;
END; $$;

NOTIFY pgrst, 'reload schema';

-- Il recupero carrelli non era misurabile: la colonna «recuperato» non la scriveva nessuno.
--
-- IL DIFETTO (radiografia del 27/8/2026, R164). `abandoned_carts` nasce (migrazione 027, riga 190)
-- con `recovered boolean NOT NULL DEFAULT false`, e la funzione che sceglie chi ricontattare filtra
-- su `ac.recovered = false` (migrazione 029, riga 205). Ma `recovered = true` non lo scriveva
-- nessuno: cercato con grep in tutto il progetto, le uniche occorrenze erano la definizione, i due
-- filtri e i tipi generati. Zero scritture.
--
-- E c'era di peggio: la riga spariva del tutto al momento dell'acquisto. Il browser, a ordine fatto,
-- chiamava `clearCart()` → `syncAbandonedCart([])` → `DELETE`. Il carrello recuperato si cancellava
-- nell'istante esatto in cui diventava una notizia.
--
-- COSA COSTAVA. L'email «hai dimenticato qualcosa» e' una delle poche leve di ricavo gia' costruite,
-- e girava alla cieca: non si poteva sapere quanto rendesse, quindi non si poteva decidere se
-- tenerla, cambiarla o spegnerla. Terzo effetto: chi riceveva l'email e NON comprava non ne riceveva
-- mai piu' una — la riga restava con `recovery_email_sent_at` valorizzato per sempre, e la funzione
-- di scelta pretende che sia NULL.
--
-- LA RIPARAZIONE, in tre pezzi (due nel codice, uno qui):
--   · il browser e il server marcano `recovered = true` invece di cancellare la riga
--     (lib/cart-sync.ts, lib/carrelli-abbandonati.ts);
--   · il salvataggio azzera `recovery_email_sent_at` quando il contenuto del carrello cambia:
--     un carrello con dentro roba diversa e' un carrello nuovo;
--   · QUI: la colonna che dice QUANDO e' tornato, senza la quale «recuperato» e' un si'/no senza
--     tempo — non si puo' misurare a quanti giorni dall'email arriva l'acquisto, che e' la domanda
--     che decide se l'invio a quattro ore e' quello giusto. La colonna serve anche alla potatura:
--     una riga recuperata da piu' di novanta giorni e' spesa di una persona tenuta senza motivo.
--
-- REVERSIBILE: `ALTER TABLE public.abandoned_carts DROP COLUMN recovered_at;`
--              `DROP INDEX public.abandoned_recuperati_idx;`

ALTER TABLE public.abandoned_carts
    ADD COLUMN IF NOT EXISTS recovered_at timestamptz;

-- La potatura cerca `recovered = true AND recovered_at < ...`: senza indice e' una scansione
-- dell'intera tabella una volta all'ora, per cancellare quasi sempre zero righe.
CREATE INDEX IF NOT EXISTS abandoned_recuperati_idx
    ON public.abandoned_carts(recovered_at)
    WHERE recovered = true;

COMMENT ON COLUMN public.abandoned_carts.recovered_at IS
    'Quando il carrello e'' tornato: l''ordine e'' stato fatto. NULL = non ancora recuperato (R164).';

-- ════════════════════════════════════════════════════════════════════════════
-- 164 — I NOMI PUBBLICI DOPO LA 161
-- 31/10/2026 · ondata 1 del sito, squadra «nomi pubblici»
-- ════════════════════════════════════════════════════════════════════════════
--
-- DI COSA PARLA
-- Tre punti del sito mostrano il nome di una persona a qualcun altro:
--   ① il nome del fattorino, al cliente (pagina dell'ordine, recensione) e al
--      negozio (pagina dell'ordine del negozio);
--   ② chi ha scritto una domanda sotto un prodotto;
--   ③ chi ha scritto una recensione nella vetrina di un negozio.
-- Tutti e tre leggevano il nome dalla tabella `profiles`. Le migrazioni 110,
-- 112 e 161 la chiudono: dopo, ognuno legge solo la propria riga (piu' gli
-- amministratori). La lettura non da' errore, torna vuota: il cliente legge
-- «Il tuo rider», il negozio «Rider assegnato», e ogni domanda e recensione e'
-- firmata «Cliente». Esempio: Luca consegna ad Anna; dopo la 161 Anna non legge
-- piu' «Luca» da nessuna parte.
--
-- COSA FA
-- Una vista sola, `nomi_pubblici (id, nome)`, che gira coi permessi di chi
-- l'ha creata (come `seller_public_profiles`) e restituisce SOLO il nome di
-- battesimo — mai il cognome, mai altre colonne — e solo di chi:
--   ① ha scritto una recensione a un negozio approvato (la stessa regola con cui
--      si leggono le recensioni, migrazione 129);
--   ② ha scritto una domanda pubblica sotto un prodotto (regola qa_public_read);
--   ③ fa da fattorino a un ordine di chi legge, come cliente o come negozio.
--      Il nome del fattorino resta invisibile a tutti gli altri.
-- La legge SOLO chi ha fatto l'accesso. Chi guarda senza account vede domande
-- e recensioni firmate «Cliente»: niente nomi a un anonimo.
-- Il sito la legge con `fetchNomiPubblici` (lib/queries/seller-public-profiles.ts).
--
-- ORDINE DI APPLICAZIONE
-- Va applicata INSIEME alla 161, o prima. Il sito regge anche senza: finche'
-- la vista non c'e' legge `profiles` come oggi (ripiego, con un avviso nei
-- registri). Ma fra la 161 applicata e questa no, i nomi spariscono.
--
-- PERCHE' NON UNA REGOLA SU `profiles`
-- Una regola di accesso apre la RIGA intera (IBAN, codice fiscale, telefono):
-- e' esattamente la porta che la 110 e la 161 hanno chiuso. La vista apre una
-- colonna sola, ridotta alla prima parola.
--
-- SICUREZZA
-- · Niente `anon`. Il collaudo del 31/10 l'ha bocciata quando la concedeva
--   anche a chi non ha l'account: con una richiesta sola a
--   /rest/v1/nomi_pubblici un anonimo scaricava l'elenco di tutti gli autori di
--   recensioni e domande, identificativo e nome. Ed e' la regola del guardiano
--   tests/unit/nessuna-funzione-potente-in-mano-a-chi-non-ha-l-account.test.ts:
--   il nome di una persona non sta in una vista leggibile senza account. Il
--   REVOKE nomina PUBLIC e anon tutti e due: i privilegi di default di Supabase
--   danno SELECT ad anon su ogni vista nuova, e togliere solo PUBLIC non chiude.
--   Limite dichiarato: chi si registra legge i nomi di battesimo degli autori,
--   cioe' quello che vede gia' sotto ogni recensione e domanda.
-- · `security_barrier`: un filtro scritto da chi interroga non vede le righe
--   prima del filtro della vista (come la 152 per le altre viste pubbliche).
-- · La vista e' semplice e quindi «aggiornabile» per PostgreSQL: coi permessi
--   del proprietario, un DELETE passato da qui cancellerebbe righe di
--   `profiles`. Per questo si toglie tutto e si concede solo SELECT (come 113).
--
-- REVERSIBILE: `DROP VIEW public.nomi_pubblici;` — il sito torna da solo a
-- leggere `profiles` (con la 161 applicata, i nomi tornano «Cliente»).
--
-- COSA NON HO VERIFICATO DA QUI
-- Non l'ho eseguita su un database vero: la logica e' provata da
-- tests/unit/i-nomi-si-leggono-anche-coi-profili-chiusi.test.ts contro un
-- database finto che riproduce questi tre filtri, e i permessi da
-- tests/unit/i-nomi-pubblici-li-legge-solo-chi-ha-l-account.test.ts, che
-- rilegge tutte le migrazioni. Prima di applicarla in produzione: eseguirla su
-- una copia e leggere la vista da anonimo (deve dire «permission denied»), da
-- cliente e da negozio.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP VIEW IF EXISTS public.nomi_pubblici;

CREATE VIEW public.nomi_pubblici
  WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  p.id,
  NULLIF(split_part(btrim(p.full_name), ' ', 1), '') AS nome
FROM public.profiles p
WHERE
  -- ① autore di una recensione di un negozio approvato
  EXISTS (
    SELECT 1
      FROM public.store_reviews r
      JOIN public.profiles s ON s.id = r.store_id
     WHERE r.user_id = p.id
       AND s.role = 'seller'
       AND s.is_approved = true
  )
  -- ② autore di una domanda pubblica sotto un prodotto
  OR EXISTS (
    SELECT 1
      FROM public.product_questions q
     WHERE q.author_id = p.id
       AND q.is_public = true
  )
  -- ③ fattorino di un ordine di chi legge (cliente o negozio)
  OR EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.rider_id = p.id
       AND (SELECT auth.uid()) IN (o.user_id, o.seller_id)
  );

COMMENT ON VIEW public.nomi_pubblici IS
  'Nome di battesimo da mostrare agli altri, solo a chi ha l account: autori di recensioni a negozi approvati e di domande pubbliche, e il fattorino per cliente e negozio del suo ordine. Permessi del proprietario apposta: profiles resta leggibile solo per la propria riga (110, 112, 161). Mai ad anon.';

REVOKE ALL ON public.nomi_pubblici FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nomi_pubblici TO authenticated;

COMMIT;

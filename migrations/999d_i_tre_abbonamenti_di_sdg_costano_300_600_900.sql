-- 999d — I tre abbonamenti di SDG costano 300, 600 e 900 € al mese (27/11/2026).
--
-- Nicola, 27/11/2026 (verso le 17:10 e le 17:45): gli abbonamenti costano Base 300 €, Business 600 € e
-- Premium 900 € al mese, e li offre MyCity tramite SDG. Il primo mese costa la metà (150, 300, 450 €).
-- Cambiano i listini in lib/agenzia/preventivo.ts (FASCE.*.prezzoMese); i prodotti di SDG nel marketplace
-- li ripetono (lib/agenzia/prodotti-sdg.ts, `prodottoSdg()`) e la prova sdg-nel-marketplace.test.ts controlla
-- che questo file dica gli stessi nomi, prezzi e descrizioni.
--
-- COSA FA. Riscrive nome, prezzo e descrizione dei tre prodotti. Stato e scorte restano come sono.
-- Nessuna tabella nuova, nessun permesso nuovo, nessun dato di persone.
-- EFFETTO DA SAPERE: il cambio di prezzo fa scattare il trigger `trg_product_price_drop`, che manda una notifica
-- «Prezzo abbassato» a chi ha il Premium (999 → 900 €) tra i preferiti. Il 27/11/2026 alle 18:30, letto in sola
-- lettura, i preferiti sui tre prodotti di SDG erano 0: prima di applicare si riconta
--   select count(*) from public.favorites where product_id::text like '11111111-1111-1111-1111-5d90000001%';
-- I due abbonamenti in contanti già attivi (tabella abbonamenti_servizi, canone 50000) NON li tocca: è una scelta
-- di Nicola se restano al prezzo con cui sono stati venduti.
--
-- NUMERO. «999d» e non «1000»: le migrazioni si applicano in ordine di byte (LC_ALL=C sort) e
-- «1000_» finirebbe prima di «101_»; lo script «Migrazioni a mano» accetta solo tre cifre più una lettera.
-- «999d_» viene dopo «999_». La 999b (il giorno della visita di SDG, mycity#351) e la 999c (l'ordine a SDG)
-- sono di altre sessioni: questa non dipende da loro e loro non dipendono da questa.
--
-- SI PUÒ RIESEGUIRE: è un UPDATE che scrive gli stessi valori ogni volta. Se i prodotti non ci sono,
-- non trova righe e non fa niente.
-- COME SI TORNA INDIETRO: si rilancia la stessa UPDATE coi valori vecchi, cioè
--   Base 300,00 · Business 500,00 · Premium 999,00 e i nomi «Abbonamento Business — 500 € al mese»,
--   «Abbonamento Premium — 999 € al mese» (testi di migrations/707 per nome e prezzo, 863 per la descrizione).
-- NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano».

BEGIN;

UPDATE public.products AS p
SET name = v.name,
    description = v.description,
    price = v.price
FROM (VALUES
    ('11111111-1111-1111-1111-5d9000000101'::uuid, 'Abbonamento Base — 300 € al mese', 'Per essere online e vendere da subito, con un aiuto costante ma leggero.

Cosa comprende:
· Foto e video: Una sessione di foto all’avvio: copertina e prodotti principali.
· Sito web professionale: Un sito di una pagina col tuo nome, collegato alla vetrina.
· Gestione dei social e di Google Maps: 8 post al mese, preparati e pubblicati da noi. Scheda Google Maps creata o sistemata all’avvio.
· Analisi del business: Il rapporto completo all’avvio: reputazione, concorrenti vicini, zona, sito, i tuoi social, calendario della città, bandi e il piano dei primi 30 giorni.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio.
· Assistenza: Su WhatsApp, risposta entro 24 ore lavorative.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.', 300.00),
    ('11111111-1111-1111-1111-5d9000000102'::uuid, 'Abbonamento Business — 600 € al mese', 'Per crescere ogni settimana: più contenuti, più clienti che ti trovano.

Cosa comprende:
· Foto e video: Foto all’avvio e una nuova sessione ogni tre mesi, più un video al mese.
· Sito web professionale: Un sito completo di più pagine, col tuo nome.
· Gestione dei social e di Google Maps: 12 post al mese, 3 a settimana, con 2 video brevi. Scheda Google Maps sistemata, più le risposte alle recensioni scritte da noi.
· Analisi del business: Il rapporto all’avvio e ogni mese: le ricerche su Google, i tuoi 3 concorrenti principali sui social e sul web, cosa è cambiato.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in evidenza nella tua categoria una settimana al mese.
· Assistenza: Su WhatsApp, risposta entro 4 ore lavorative.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.', 600.00),
    ('11111111-1111-1111-1111-5d9000000103'::uuid, 'Abbonamento Premium — 900 € al mese', 'Il servizio completo: foto e video ogni mese, un referente tutto tuo.

Cosa comprende:
· Foto e video: Una sessione di foto e video ogni mese.
· Sito web professionale: Un sito completo, aggiornato da noi ogni mese.
· Gestione dei social e di Google Maps: 20 post al mese, 4 video brevi e le storie. Scheda Google Maps curata ogni mese: foto nuove, post e risposte alle recensioni.
· Analisi del business: Il rapporto aggiornato ogni settimana, con fino a 5 concorrenti sui social e sul web e le idee che ne nascono, e un incontro al mese per leggerlo insieme.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in home page due settimane al mese.
· Assistenza: Un referente tutto tuo e una visita nel locale ogni mese.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.', 900.00)
) AS v(id, name, description, price)
WHERE p.id = v.id
  AND p.seller_id = '11111111-1111-1111-1111-5d9000000001'::uuid;

COMMIT;

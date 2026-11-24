-- 710 — I tre abbonamenti di SDG Agenzia dicono i servizi a 3 (24/11/2026).
--
-- Nicola: «Di per sé il preventivo sono quelle tre voci: foto e video, sito e social, gestione di
-- social. E gestione di social dentro è compreso anche Google Maps». I servizi passano da quattro a
-- tre: la scheda Google su Maps entra nella gestione dei social (lib/agenzia/preventivo.ts). E
-- l'abbonamento non si attiva più «dal preventivo»: si sceglie nella pagina Abbonamento del negozio.
--
-- COSA FA. Riscrive SOLO la descrizione dei tre prodotti di SDG creati dalla 707: nome, prezzo,
-- stato e scorte restano come sono. Le descrizioni sono quelle di lib/agenzia/prodotti-sdg.ts (dal
-- listino FASCE); la prova tests/unit/sdg-nel-marketplace.test.ts controlla che coincidano.
--
-- ORDINE. Va dopo la 707, che crea i prodotti. Se la 707 non c'è ancora, questo UPDATE non trova
-- righe e non fa niente; quando poi la 707 entra, scrive le descrizioni vecchie: per questo la 707
-- e la 710 vanno applicate in fila, come fa il pulsante.
--
-- PERMESSI. Nessuna tabella, funzione o regola nuova.
-- Si può rieseguire. NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano».
-- REVERSIBILE: rieseguire il blocco INSERT … ON CONFLICT della 707, che rimette le descrizioni di prima.

BEGIN;

UPDATE public.products AS p
SET description = v.description
FROM (VALUES
    ('11111111-1111-1111-1111-5d9000000101'::uuid, 'Per essere online e vendere da subito, con un aiuto costante ma leggero.

Cosa comprende:
· Foto e video: Una sessione di foto all’avvio: copertina e prodotti principali.
· Sito web professionale: Un sito di una pagina col tuo nome, collegato alla vetrina.
· Gestione dei social e di Google Maps: 8 post al mese, preparati e pubblicati da noi. Scheda Google Maps creata o sistemata all’avvio.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio.
· Assistenza: Su WhatsApp, risposta entro 24 ore lavorative.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.'),
    ('11111111-1111-1111-1111-5d9000000102'::uuid, 'Per crescere ogni settimana: più contenuti, più clienti che ti trovano.

Cosa comprende:
· Foto e video: Foto all’avvio e una nuova sessione ogni tre mesi, più un video al mese.
· Sito web professionale: Un sito completo di più pagine, col tuo nome.
· Gestione dei social e di Google Maps: 12 post al mese, 3 a settimana, con 2 video brevi. Scheda Google Maps sistemata, più le risposte alle recensioni scritte da noi.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in evidenza nella tua categoria una settimana al mese.
· Assistenza: Su WhatsApp, risposta entro 4 ore lavorative.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.'),
    ('11111111-1111-1111-1111-5d9000000103'::uuid, 'Il servizio completo: foto e video ogni mese, un referente tutto tuo.

Cosa comprende:
· Foto e video: Una sessione di foto e video ogni mese.
· Sito web professionale: Un sito completo, aggiornato da noi ogni mese.
· Gestione dei social e di Google Maps: 20 post al mese, 4 video brevi e le storie. Scheda Google Maps curata ogni mese: foto nuove, post e risposte alle recensioni.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in home page due settimane al mese.
· Assistenza: Un referente tutto tuo e una visita nel locale ogni mese.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.')
) AS v(id, description)
WHERE p.id = v.id
  AND p.seller_id = '11111111-1111-1111-1111-5d9000000001'::uuid;

COMMIT;

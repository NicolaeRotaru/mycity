-- 863 — Gli abbonamenti di SDG dicono il rapporto dell'imprenditore (26/11/2026).
--
-- Nicola, 26/11: l'analisi del business diventa il rapporto dell'imprenditore e si personalizza per abbonamento
-- (Base all'avvio; Business ogni mese, coi 3 concorrenti principali sui social e sul web; Premium ogni settimana,
-- fino a 5 concorrenti e un incontro al mese). Prezzi invariati. Cambia il testo di `FASCE.*.servizi.analisi`
-- (lib/agenzia/preventivo.ts), e le descrizioni dei tre abbonamenti di SDG nel marketplace lo ripetono parola per
-- parola (lib/agenzia/prodotti-sdg.ts; la prova sdg-nel-marketplace.test.ts controlla che coincidano).
--
-- COSA FA. Solo questo: riscrive la descrizione dei tre prodotti. Nome, prezzo, stato e scorte restano come sono.
-- Nessuna tabella nuova, nessun permesso nuovo, nessun dato di persone.
--
-- ORDINE. Dopo la 711. Se i prodotti non ci sono, l'UPDATE non trova righe e non fa niente.
-- Si può rieseguire. NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano».

BEGIN;

UPDATE public.products AS p
SET description = v.description
FROM (VALUES
    ('11111111-1111-1111-1111-5d9000000101'::uuid, 'Per essere online e vendere da subito, con un aiuto costante ma leggero.

Cosa comprende:
· Foto e video: Una sessione di foto all’avvio: copertina e prodotti principali.
· Sito web professionale: Un sito di una pagina col tuo nome, collegato alla vetrina.
· Gestione dei social e di Google Maps: 8 post al mese, preparati e pubblicati da noi. Scheda Google Maps creata o sistemata all’avvio.
· Analisi del business: Il rapporto completo all’avvio: reputazione, concorrenti vicini, zona, sito, i tuoi social, calendario della città, bandi e il piano dei primi 30 giorni.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio.
· Assistenza: Su WhatsApp, risposta entro 24 ore lavorative.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.'),
    ('11111111-1111-1111-1111-5d9000000102'::uuid, 'Per crescere ogni settimana: più contenuti, più clienti che ti trovano.

Cosa comprende:
· Foto e video: Foto all’avvio e una nuova sessione ogni tre mesi, più un video al mese.
· Sito web professionale: Un sito completo di più pagine, col tuo nome.
· Gestione dei social e di Google Maps: 12 post al mese, 3 a settimana, con 2 video brevi. Scheda Google Maps sistemata, più le risposte alle recensioni scritte da noi.
· Analisi del business: Il rapporto all’avvio e ogni mese: le ricerche su Google, i tuoi 3 concorrenti principali sui social e sul web, cosa è cambiato.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in evidenza nella tua categoria una settimana al mese.
· Assistenza: Su WhatsApp, risposta entro 4 ore lavorative.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.'),
    ('11111111-1111-1111-1111-5d9000000103'::uuid, 'Il servizio completo: foto e video ogni mese, un referente tutto tuo.

Cosa comprende:
· Foto e video: Una sessione di foto e video ogni mese.
· Sito web professionale: Un sito completo, aggiornato da noi ogni mese.
· Gestione dei social e di Google Maps: 20 post al mese, 4 video brevi e le storie. Scheda Google Maps curata ogni mese: foto nuove, post e risposte alle recensioni.
· Analisi del business: Il rapporto aggiornato ogni settimana, con fino a 5 concorrenti sui social e sul web e le idee che ne nascono, e un incontro al mese per leggerlo insieme.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in home page due settimane al mese.
· Assistenza: Un referente tutto tuo e una visita nel locale ogni mese.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.')

) AS v(id, description)
WHERE p.id = v.id
  AND p.seller_id = '11111111-1111-1111-1111-5d9000000001'::uuid;

COMMIT;

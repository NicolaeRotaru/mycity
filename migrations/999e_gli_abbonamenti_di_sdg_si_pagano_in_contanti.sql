-- 999e — Gli abbonamenti di SDG dicono che per ora si pagano in contanti (27/11/2026).
--
-- Nicola, 26/11/2026 verso le 16:00: per ora l'abbonamento si paga in contanti, di persona, e il pagamento
-- online dei servizi è spento (lib/agenzia/pagamento-servizi.ts, PAGAMENTO_ONLINE_SERVIZI = false). Le
-- descrizioni dei tre prodotti di SDG, scritte dalla 863 e poi dalla 999d, dicevano ancora «Si attiva dalla
-- pagina Abbonamento del tuo negozio»: oggi dalla pagina Abbonamento il titolare chiede l'abbonamento e lo
-- paga di persona. La frase viene da lib/agenzia/prodotti-sdg.ts (FRASE_COME_SI_PRENDE) e la prova
-- sdg-nel-marketplace.test.ts controlla che questo file dica le stesse descrizioni.
--
-- COSA FA. Solo questo: riscrive la descrizione dei tre prodotti. Nome, prezzo (quelli della 999d), stato e
-- scorte restano come sono. Nessuna tabella nuova, nessun permesso nuovo, nessun dato di persone. Cambia
-- solo la frase su come si prende l'abbonamento; il resto è uguale alla 999d.
--
-- NUMERO. «999e»: viene dopo «999d_» in ordine di byte. La 999c (mycity#353, l'ordine a SDG) è di un'altra
-- sessione: questa non dipende da lei e lei non dipende da questa. Va applicata DOPO la 999d, che riscrive
-- anche le descrizioni: applicata prima, la 999d rimetterebbe la frase vecchia.
--
-- SI PUÒ RIESEGUIRE: è un UPDATE che scrive gli stessi valori ogni volta. Se i prodotti non ci sono,
-- non trova righe e non fa niente.
-- COME SI TORNA INDIETRO: si rilancia la 999d (rimette la frase «Si attiva dalla pagina Abbonamento»).
-- QUANDO SI RIACCENDE IL PAGAMENTO ONLINE serve una migrazione nuova con la frase di prima.
-- NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano».

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

Non si compra dal carrello: lo chiedi dalla pagina Abbonamento della tua attività e, per ora, si paga in contanti, di persona. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.'),
    ('11111111-1111-1111-1111-5d9000000102'::uuid, 'Per crescere ogni settimana: più contenuti, più clienti che ti trovano.

Cosa comprende:
· Foto e video: Foto all’avvio e una nuova sessione ogni tre mesi, più un video al mese.
· Sito web professionale: Un sito completo di più pagine, col tuo nome.
· Gestione dei social e di Google Maps: 12 post al mese, 3 a settimana, con 2 video brevi. Scheda Google Maps sistemata, più le risposte alle recensioni scritte da noi.
· Analisi del business: Il rapporto all’avvio e ogni mese: le ricerche su Google, i tuoi 3 concorrenti principali sui social e sul web, cosa è cambiato.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in evidenza nella tua categoria una settimana al mese.
· Assistenza: Su WhatsApp, risposta entro 4 ore lavorative.

Non si compra dal carrello: lo chiedi dalla pagina Abbonamento della tua attività e, per ora, si paga in contanti, di persona. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.'),
    ('11111111-1111-1111-1111-5d9000000103'::uuid, 'Il servizio completo: foto e video ogni mese, un referente tutto tuo.

Cosa comprende:
· Foto e video: Una sessione di foto e video ogni mese.
· Sito web professionale: Un sito completo, aggiornato da noi ogni mese.
· Gestione dei social e di Google Maps: 20 post al mese, 4 video brevi e le storie. Scheda Google Maps curata ogni mese: foto nuove, post e risposte alle recensioni.
· Analisi del business: Il rapporto aggiornato ogni settimana, con fino a 5 concorrenti sui social e sul web e le idee che ne nascono, e un incontro al mese per leggerlo insieme.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in home page due settimane al mese.
· Assistenza: Un referente tutto tuo e una visita nel locale ogni mese.

Non si compra dal carrello: lo chiedi dalla pagina Abbonamento della tua attività e, per ora, si paga in contanti, di persona. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.')
) AS v(id, description)
WHERE p.id = v.id
  AND p.seller_id = '11111111-1111-1111-1111-5d9000000001'::uuid;

COMMIT;

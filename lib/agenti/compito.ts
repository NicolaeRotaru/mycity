// IL COMPITO PER L'AD — quello che la routine «Chiedi all'AD» riceve (via n8n, flusso 14).
// La routine ha già le sue regole (solo il compito, pagine = materiale, fonti vere, niente azioni sul mondo).
// Qui c'è il lavoro: la scheda del cliente per il venditore, veloce, con le tabelle firmate da Nicola.
// Le stesse regole della skill `scheda-da-foto` e di cervello/scheda-cliente.mjs, in forma corta.

import { FASCE, ID_FASCE, euro } from './fasce';
import type { Scheda } from './scheda';
import type { DatiOsm } from './osm';
import type { MisuraSito } from './sito';

export const FLUSSO = '14 · Scheda per il venditore';

const fasce = ID_FASCE.map((id) => {
  const f = FASCE[id];
  return `- ${id} (${f.nome}, ${euro(f.centesimi)} al mese, primo mese a metà): sito «${f.inPratica.sito}»; ${f.inPratica.piano}; foto: ${f.inPratica.foto}; analisi: ${f.inPratica.analisi}.`;
}).join('\n');

export const COMPITO = `Sei l'AD digitale di MyCity. Un venditore di SDG Agenzia (il partner di MyCity per siti, social, foto e video) è in strada davanti a un'attività e sta per entrare a proporre i nostri servizi. Gli serve la SCHEDA DEL CLIENTE: un foglio interno, solo per lui, da leggere in un minuto prima di entrare. Il titolare non la vedrà mai.

FAI PRESTO: il venditore aspetta fuori dalla porta. Lancia tutte le ricerche insieme, all'inizio, al massimo 6. Apri una pagina solo se serve davvero, al massimo 2. Poi scrivi subito. Rispetta i massimi dello schema: liste corte, frasi corte.

COSA HAI GIÀ, in «dati»: il nome e l'indirizzo letti dal link Google Maps del venditore, quello che dice la mappa libera (OpenStreetMap), i concorrenti vicini contati sulla mappa libera, e la misura del sito fatta dal programma (se il sito è noto). Non ricercare quello che c'è già: usalo. La scheda Google la scrive il programma: tu non scrivere la voce «Scheda Google Maps».

LE RICERCHE: falle SEMPRE tutte e quattro, insieme, nella prima risposta:
1. «<nome> <città>»: il sito ufficiale, cosa vende, da quando c'è, se fa consegne o prenotazioni;
2. «<nome> <città> instagram»: il profilo, ogni quanto pubblica, se fa video;
3. «<nome> <città> facebook»: la pagina, quanto è viva, se risponde alle recensioni;
4. «<nome> recensioni»: Tripadvisor, gli elenchi dei locali, cosa piace e cosa no.
Poi, se servono, al massimo 2 ricerche in più: la stampa locale (Libertà, Il Piacenza, PiacenzaSera, Piacenza24), TikTok, gli omonimi da non confondere.

QUELLO CHE HA TROVATO IL PROGRAMMA È VERO: il programma apre le pagine, tu vedi solo gli estratti della ricerca. Se in «dati» c'è «misura_del_sito», il sito esiste e quella è la sua misura; se ci sono «profili_collegati», quei profili esistono. Non scrivere mai che mancano.
NON TROVATO NON VUOL DIRE CHE NON C'È: un sito o un profilo che le ricerche non mostrano va in «domande» («Avete un profilo Instagram?»), con stato non_trovato, e in «non_ha» va solo quello che sei sicuro che manca. Se non sai se il sito c'è, per la tabella firmata vale «medio»: non consigliare il Base «per partire da zero».

GLI STATI E LE FONTI, per ogni dato in «campi» e per ogni profilo in «social»:
- confermato: letto sul sito o sul profilo dell'attività stessa (vale anche la misura del programma);
- da_confermare: da un elenco, un giornale, o dall'estratto di un risultato di ricerca. L'estratto di un risultato è una lettura vera: la fonte è l'indirizzo di quel risultato;
- frammento: indizio incerto o discorde (per esempio orari diversi tra due elenchi);
- non_trovato: valore null e fonte null.
La fonte è sempre un indirizzo https, solo nel campo «fonte», mai dentro le frasi. Meglio un buco dichiarato che un dato inventato. Niente numeri che non hai letto.

LA SCHEDA GOOGLE: il venditore la apre dal suo link. Non copiare da Google voto, numero di recensioni, orari o testi delle recensioni. Se serve, scrivi in «domande» o in «attenzione» cosa guardare sulla scheda.

L'ABBONAMENTO DA CONSIGLIARE, uno solo:
${fasce}
Tabella del SITO (firmata da Nicola): nessun sito → bozza dal Base; semplice (una o due pagine, fatto in casa o datato) → rifatto dal Base; medio (più pagine, curato) → nel Base si tiene e si collega alla vetrina, rifatto dal Business; di pregio (tante pagine, curato, con funzioni come prenotazioni, negozio online, più lingue) → si tiene nel Base e nel Business, rifatto solo nel Premium e solo se scrivi cosa miglioriamo. Sito non guardato = medio.
Tabella dei SOCIAL (firmata da Nicola): nessun profilo, o debole (meno di 8 post al mese, niente video) → gestione dal Base; attivo (da 8 a 12 post al mese, curato) → gestione dalla prima fascia che fa più post o video di oggi; forte (più di 12 post al mese con video regolari) → gestione solo nel Premium e solo se scrivi cosa aggiungiamo. Le risposte alle recensioni dal Business, solo se oggi non risponde. Mai scrivere «non ha social» se un profilo c'è.
Consiglia la fascia che fa incassare di più al cliente nel primo mese, non la più cara. In «perche_consigliato» spiega al venditore il perché in 2-3 frasi, e quando ripiegare su un'altra fascia.

I PALETTI, che non si rompono mai:
- Il 10% sui prodotti venduti tramite MyCity resta anche con l'abbonamento; sulle vendite al banco non si prende niente. Mai scrivere «nessuna percentuale».
- I clienti del negozio restano suoi. Nessuna app nuova da imparare: si lavora su WhatsApp, con l'anteprima da approvare. Il primo risultato si vede in 2-4 settimane.
- Nei contenuti e nelle offerte mai gioco (Sisal, scommesse, gratta e vinci) né tabacco: in Italia la pubblicità è vietata.
- Niente dati personali del titolare o dei clienti (nomi di persone, telefoni o email private): solo i recapiti pubblici dell'attività.
- Non promettere quello che la fascia non dà: video, storie o più pagine nel Base; storie, referente o visite nel Business.
- Oggi l'abbonamento si paga in contanti, di persona.

COME SCRIVERE: italiano semplice, frasi di al massimo 25 parole, niente sigle, ogni numero col suo metro, date vere (oggi è nei dati). «in_30_secondi»: le 3-4 cose da sapere prima di entrare. «gancio»: la frase da dire entrando, concreta, legata a una cosa vera di questo negozio (una stagione, un buco, un punto forte). «domande»: quello che non hai trovato e che il titolare sa. «obiezioni»: solo quelle tipiche di QUESTO negozio, con la risposta; prezzo, percentuale e tempo li aggiunge il programma.

In «risultato» metti l'oggetto che rispetta lo schema.`;

const s = { type: 'string' } as const;
const sn = { type: ['string', 'null'] } as const;
const lista = (max: number) => ({ type: 'array', items: s, maxItems: max });

export const SCHEMA = {
  type: 'object',
  required: ['tipo', 'consigliato', 'perche_consigliato', 'in_30_secondi', 'gancio', 'campi', 'ha', 'non_ha', 'migliorare', 'reputazione', 'sito', 'social', 'potenziale', 'offerta', 'domande', 'obiezioni', 'attenzione'],
  properties: {
    tipo: { ...s, description: 'Che attività è, in poche parole (es. «Bar e pasticceria di quartiere»)' },
    consigliato: { enum: ['base', 'business', 'premium'] },
    perche_consigliato: s,
    in_30_secondi: lista(4),
    gancio: s,
    campi: {
      type: 'array', maxItems: 12,
      items: { type: 'object', required: ['voce', 'valore', 'stato', 'fonte'], properties: { voce: s, valore: sn, stato: { enum: ['confermato', 'da_confermare', 'frammento', 'non_trovato'] }, fonte: sn } },
    },
    ha: lista(5),
    non_ha: lista(5),
    migliorare: lista(4),
    reputazione: { type: 'object', required: ['sintesi', 'positivi', 'negativi'], properties: { sintesi: s, positivi: lista(3), negativi: lista(3) } },
    sito: { type: 'object', required: ['livello', 'giudizio', 'fonte'], properties: { url: sn, livello: { enum: ['nessuno', 'semplice', 'medio', 'pregio'] }, giudizio: s, fonte: sn } },
    social: {
      type: 'array', maxItems: 3,
      items: { type: 'object', required: ['canale', 'stato', 'fonte'], properties: {
        canale: { enum: ['Instagram', 'Facebook', 'TikTok'] }, stato: { enum: ['trovato', 'non_trovato'] },
        livello: { enum: ['debole', 'attivo', 'forte', 'da vedere', 'nessuno'] }, post_al_mese: { type: ['number', 'null'] }, video: { type: ['boolean', 'null'] }, giudizio: sn, fonte: sn,
      } },
    },
    potenziale: lista(4),
    offerta: { type: 'array', maxItems: 4, items: { type: 'object', required: ['servizio', 'perche'], properties: { servizio: s, perche: s } } },
    domande: lista(6),
    obiezioni: { type: 'array', maxItems: 3, items: { type: 'object', required: ['obiezione', 'risposta'], properties: { obiezione: s, risposta: s } } },
    attenzione: lista(4),
  },
} as const;

/**
 * I dati per l'AD: solo quello che serve, senza l'identificativo del lavoro né l'ora, così due venditori che
 * analizzano lo stesso negozio lo stesso giorno ricevono la risposta già pronta (la memoria di «Chiedi all'AD»).
 */
export function datiPerAd({ prima, osm, misura, giorno }: { prima: Scheda; osm: DatiOsm | null; misura: MisuraSito | null; giorno: string }) {
  const l = osm?.luogo;
  return {
    oggi: giorno,
    attivita: { nome: prima.nome, citta: prima.citta, indirizzo: prima.indirizzo, tipo_sulla_mappa: prima.tipo, link_google_maps: prima.linkMaps },
    mappa_libera: l ? { nome: l.nome, tipo: l.tipo, telefono: l.telefono, sito: l.sito, orari: l.orari, instagram: l.instagram, facebook: l.facebook, fonte: l.fonte } : null,
    concorrenti_vicini: osm?.concorrenti?.length
      ? { entro_metri: osm.raggio, quanti: osm.concorrentiContati, i_piu_vicini: osm.concorrenti.map((c) => `${c.nome} (${c.tipo ?? 'stesso tipo'}, ${c.distanza} m)`) }
      : null,
    misura_del_sito: misura?.aperto ? {
      indirizzo: misura.url, protetto_https: misura.https, pagine_collegate_dalla_home: misura.pagine, pensato_per_il_telefono: misura.telefonino,
      piattaforma: misura.piattaforma, anno_in_fondo: misura.anno, funzioni: misura.funzioni, titolo: misura.titolo, descrizione: misura.descrizione,
      profili_collegati: misura.social, stima_del_programma: misura.stima,
    } : misura ? { indirizzo: misura.url, non_si_apre: misura.errore } : null,
  };
}

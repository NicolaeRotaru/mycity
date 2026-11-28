import { z } from 'zod';
import { FASCE } from '@/lib/agenti/fasce';
import type { Scheda } from '@/lib/agenti/scheda';
import type { Abbonamento } from './preventivo';
import { TIPI_CONTENUTO, type ContenutoDelPiano, type PianoDelMese } from './piano-del-primo-mese';
import { fraseMostrabile } from './rapporto';
import { haUnNomeDiPersona } from './nomi-di-persona';

/**
 * IL PIANO COMPLETO, CHIESTO ALL'AD — 27/11/2026.
 *
 * Il piano che il sito mette subito nell'ordine di SDG (lib/agenzia/piano-del-primo-mese.ts) ha gli esempi per il
 * tipo di attività. Quello completo, nel formato del Caffè di Piacenza (eventi veri della città, didascalie
 * scritte per QUEL locale), lo scrive l'AD con la routine «90 · Chiedi all'AD», la stessa che scrive la scheda per
 * l'agente. La strada è il flusso n8n 14 «Scheda per il venditore» così com'è, senza toccarlo: il suo nodo
 * «Controlla il lavoro» accetta qualunque compito con dati e schema (letto dal flusso vivo il 27/11), e il 14b
 * restituisce il risultato per codice del lavoro (lib/agenti/n8n.ts → avviaLavoro e leggiLavoro).
 *
 * Il «venditore» di questi lavori è l'indirizzo di sistema di SDG (migrazione 707), non l'agente: così il piano
 * non finisce fra «Le tue ultime schede» di nessun agente, e quando torna si riconosce come un piano.
 *
 * Verso n8n vanno solo dati del locale che n8n ha già (nome, tipo, città, indirizzo pubblico, quello che l'AD
 * stesso ha scritto nella scheda dell'agente) più l'abbonamento, le quantità e il periodo. Mai l'email del
 * titolare, mai l'email dell'agente, mai l'ora della visita.
 */

/** L'email di sistema di SDG Agenzia (migrazione 707): il «venditore» dei lavori di piano. */
export const VENDITORE_DEI_PIANI = 'sdg.servizi@mycity-system.local';

/** I tetti del nodo «Controlla il lavoro» del flusso 14, letti dal flusso vivo il 27/11/2026. */
export const TETTI_FLUSSO_14 = { compito: 30_000, richiesta: 60_000, prima: 80_000 } as const;

export const COMPITO_PIANO = `Sei l'AD digitale di MyCity. SDG Agenzia (il partner di MyCity per siti, social, foto e video) ha un cliente nuovo: il titolare ha appena confermato l'abbonamento. Prepara il PIANO EDITORIALE DEL PRIMO MESE, pronto da lavorare per il team creativo. Il titolare lo vedrà come bozza nella sua pagina e lo confermerà con SDG alla prima visita.

IL FORMATO è quello del piano del Caffè di Piacenza, dicembre 2026: in testa cliente, abbonamento, canali e tono, hashtag fissi, cosa confermare prima di pubblicare; poi una riga per ogni contenuto con data, ora, tipo (Post, Carosello, Reel), tema, didascalia proposta, cosa riprendere, evento in città.
Esempio di una riga del Caffè: data 2026-12-05, ora 09:00, tipo Reel, tema «Sabato di mercato in Piazza Duomo», didascalia «Il sabato mattina Piazza Duomo si riempie di banchi e di voci. Il giro al mercato comincia (e finisce) con un caffè da noi. #Piacenza #CaffèDiPiacenza #PiazzaDuomo», cosa riprendere «Video verticale di 15-20 secondi, 5 clip da 3 secondi: banchi del mercato, gente che passa, porta del bar, cappuccino servito. Niente volti riconoscibili in primo piano», in città «Mercato del sabato mattina».

COSA HAI, in «dati»: il locale (nome, tipo, città, indirizzo), l'abbonamento con le QUANTITÀ, il PERIODO, quello che hai già scritto nella scheda per il venditore (cosa ha, cosa manca, reputazione, social, cosa faremo con questa fascia), e il piano di partenza del sito. Usali: non rifare la scheda.

LE QUANTITÀ SONO UN CONTRATTO: esattamente «contenuti» contenuti fra Post, Carosello e Reel, di cui esattamente «video» Reel. Non di più e non di meno: è quello che il titolare ha comprato. Nel Base nessun video. Le storie solo se «storie» è vero, con tipo «Storia», e non contano nei contenuti.

LE DATE stanno tutte dentro il periodo (dal, al compresi), al massimo un contenuto al giorno fra Post, Carosello e Reel. Le ore sono quelle in cui i clienti di quel tipo di locale guardano il telefono (un bar la mattina, un ristorante la sera).

GLI EVENTI IN CITTÀ: cerca gli eventi veri della città del locale nel periodo (mercati, feste, concerti, ricorrenze, eventi della parrocchia o del comune). Al massimo 4 ricerche. In «in_citta» metti l'evento di quel giorno o dei giorni vicini, e in «fonte_evento» l'indirizzo https dove l'hai letto; se non hai una fonte vera, null in tutti e due. Meglio vuoto che inventato.

LE REGOLE, che non si rompono mai:
- Prezzi, prodotti, orari e telefoni solo se li hai nei dati come confermati: mai inventati. Se un contenuto dipende da un'apertura o da un orario non confermato, scrivilo in «cosa_riprendere»: «da pubblicare solo se il titolare conferma …».
- Persone riconoscibili in foto e video solo col consenso scritto: dillo in «cosa_riprendere» quando servono.
- Niente gioco (Sisal, scommesse, gratta e vinci) né tabacco. Alcol raccontato in modo responsabile: niente inviti a bere tanto.
- Mai superlativi che non si possono provare («il migliore», «l'unico»). Niente recensioni comprate o scambiate con sconti.
- Musica dei reel solo con licenza per uso commerciale.
- Una proposta nuova (un menu, un evento, un buono) solo come idea: «se il titolare dice sì».
- Niente dati personali del titolare o dei clienti: solo i recapiti pubblici del locale.
- Gli hashtag fissi chiudono ogni didascalia.

COME SCRIVERE: italiano semplice, frasi di al massimo 25 parole, il tono del locale. Didascalie di al massimo 400 caratteri. In «prima_di_pubblicare» le cose da confermare col titolare. In «note» al massimo 4 righe per il team (cosa preparare alla visita, cosa manca).

In «risultato» metti l'oggetto che rispetta lo schema.`;

const s = { type: 'string' } as const;
const sn = { type: ['string', 'null'] } as const;

export const SCHEMA_PIANO = {
  type: 'object',
  required: ['intestazione', 'contenuti', 'note'],
  properties: {
    intestazione: {
      type: 'object',
      required: ['canali_e_tono', 'hashtag', 'prima_di_pubblicare'],
      properties: { canali_e_tono: s, hashtag: s, prima_di_pubblicare: s },
    },
    contenuti: {
      type: 'array', maxItems: 40,
      items: {
        type: 'object',
        required: ['data', 'ora', 'tipo', 'tema', 'didascalia', 'cosa_riprendere', 'in_citta', 'fonte_evento'],
        properties: {
          data: { ...s, description: 'AAAA-MM-GG, dentro il periodo' },
          ora: { ...s, description: 'HH:MM' },
          tipo: { enum: [...TIPI_CONTENUTO] },
          tema: s, didascalia: s, cosa_riprendere: s, in_citta: sn, fonte_evento: sn,
        },
      },
    },
    note: { type: 'array', items: s, maxItems: 4 },
  },
} as const;

/** Quello che il piano completo chiede alla scheda dell'agente: solo le parti scritte dall'AD sul locale. */
export function dallaSchedaDellAgente(scheda: Scheda | null, fascia: Abbonamento) {
  if (!scheda) return null;
  const corto = (v: string | null | undefined, max = 300) => (v ? v.slice(0, max) : null);
  const elenco = (v: string[] | undefined, quanti = 5) => (v ?? []).slice(0, quanti).map((x) => x.slice(0, 200));
  const su = scheda.su_misura?.[fascia];
  return {
    tipo: corto(scheda.tipo, 120),
    ha: elenco(scheda.ha),
    non_ha: elenco(scheda.non_ha),
    migliorare: elenco(scheda.migliorare, 4),
    potenziale: elenco(scheda.potenziale, 4),
    reputazione: { sintesi: corto(scheda.reputazione?.sintesi), positivi: elenco(scheda.reputazione?.positivi, 3), negativi: elenco(scheda.reputazione?.negativi, 3) },
    sito: { livello: scheda.sito?.livello ?? 'non visto', giudizio: corto(scheda.sito?.giudizio) },
    social: (scheda.social ?? []).slice(0, 3).map((x) => ({ canale: x.canale, stato: x.stato, livello: x.livello, giudizio: corto(x.giudizio, 200) })),
    con_questa_fascia: su ? { perche: corto(su.perche, 400), ...Object.fromEntries(Object.entries(su.servizi ?? {}).map(([k, v]) => [k, corto(v, 360)])) } : null,
  };
}

/** I dati per l'AD. Il piano di partenza resta fuori se il lavoro supererebbe il tetto della routine. */
export function datiPerIlPianoCompleto(input: {
  nome: string; tipo: string; citta: string; indirizzo: string | null; fascia: Abbonamento; piano: PianoDelMese; scheda: ReturnType<typeof dallaSchedaDellAgente>;
}) {
  const f = FASCE[input.fascia];
  const dati = {
    locale: { nome: input.nome.slice(0, 120), tipo: input.tipo, citta: input.citta.slice(0, 60), indirizzo: input.indirizzo ? input.indirizzo.slice(0, 200) : null },
    abbonamento: { fascia: input.fascia, nome: f.nome, in_pratica: f.inPratica.piano, contenuti: f.post, video: f.video, storie: input.fascia === 'premium' },
    periodo: { dal: input.piano.periodo.dal, al: input.piano.periodo.al },
    hashtag_proposti: input.piano.intestazione.hashtag,
    dalla_scheda_del_venditore: input.scheda,
    piano_di_partenza: input.piano.contenuti.map((c) => ({ data: c.data, ora: c.ora, tipo: c.tipo, tema: c.tema, didascalia: c.didascalia })),
  };
  const misura = (x: unknown) => JSON.stringify({ compito: COMPITO_PIANO, dati: x, schema: SCHEMA_PIANO }).length;
  if (misura(dati) <= TETTI_FLUSSO_14.richiesta) return dati;
  const senzaPartenza = { ...dati, piano_di_partenza: [] };
  if (misura(senzaPartenza) <= TETTI_FLUSSO_14.richiesta) return senzaPartenza;
  return { ...senzaPartenza, dalla_scheda_del_venditore: null };
}

// ———————————————————————————————— la risposta dell'AD, controllata

const senzaControllo = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const testo = (max: number) => z.string().transform(senzaControllo).pipe(z.string().min(1).max(max));
const giorno = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const fonte = z.string().max(600).regex(/^https:\/\/[^\s"'<>]+$/);

const RispostaDellAd = z.object({
  intestazione: z.object({ canali_e_tono: testo(300), hashtag: testo(200), prima_di_pubblicare: testo(600) }),
  contenuti: z.array(z.object({
    data: giorno,
    ora,
    tipo: z.enum(TIPI_CONTENUTO),
    tema: testo(120),
    didascalia: testo(600),
    cosa_riprendere: testo(600),
    in_citta: z.union([testo(300), z.null()]),
    fonte_evento: z.union([fonte, z.null()]),
  })).min(1).max(40),
  note: z.array(testo(300)).max(4),
});

/** Perché una risposta dell'AD non entra nell'ordine, o il piano completo pronto da salvare. */
export type EsitoRisposta = { ok: true; piano: PianoDelMese } | { ok: false; motivo: string };

/**
 * Le regole che non si rompono: dentro il periodo, le quantità della fascia, niente gioco né tabacco. Il gioco e il
 * tabacco si cercano nei temi e nelle didascalie, senza gli hashtag e senza il nome del locale: un «Bar Tabacchi»
 * può chiamarsi così, ma non può pubblicizzare le sigarette.
 */
const VIETATI = /\b(sisal|scommess\w*|gratta e vinci|superenalotto|tabacc\w*|sigarett\w*|sigar[oi])\b/i;

export function pianoDallaRisposta(grezza: unknown, partenza: PianoDelMese, fascia: Abbonamento): EsitoRisposta {
  const letta = RispostaDellAd.safeParse(grezza);
  if (!letta.success) return { ok: false, motivo: `il piano dell’AD non ha la forma giusta (${letta.error.issues[0]?.path.join('.') || 'risposta'})` };
  const r = letta.data;
  const { dal, al } = partenza.periodo;
  const f = FASCE[fascia];
  if (r.contenuti.some((c) => c.data < dal || c.data > al)) return { ok: false, motivo: 'il piano dell’AD ha date fuori dal periodo' };
  const feed = r.contenuti.filter((c) => c.tipo !== 'Storia');
  const reel = feed.filter((c) => c.tipo === 'Reel').length;
  if (feed.length !== f.post || reel !== f.video) {
    return { ok: false, motivo: `il piano dell’AD non rispetta le quantità del ${f.nome}: ${feed.length} contenuti e ${reel} video invece di ${f.post} e ${f.video}` };
  }
  if (fascia !== 'premium' && r.contenuti.some((c) => c.tipo === 'Storia')) return { ok: false, motivo: `il piano dell’AD mette le storie nel ${f.nome}, che non le comprende` };
  if (new Set(feed.map((c) => c.data)).size !== feed.length) return { ok: false, motivo: 'il piano dell’AD mette due contenuti nello stesso giorno' };
  const nome = partenza.intestazione.cliente.split(',')[0].trim().toLowerCase();
  const pulito = (t: string) => { const x = t.replace(/#[\p{L}\p{N}_]+/gu, ' ').toLowerCase(); return nome.length >= 2 ? x.split(nome).join(' ') : x; };
  if (r.contenuti.some((c) => VIETATI.test(pulito(`${c.tema} ${c.didascalia}`)))) return { ok: false, motivo: 'il piano dell’AD nomina gioco o tabacco, che non si pubblicizzano' };
  if (/@[a-z0-9-]+\.[a-z]{2,}/i.test(JSON.stringify(r))) return { ok: false, motivo: 'il piano dell’AD contiene un indirizzo email' };
  // Collaudo 28/11/2026 — Il piano dell'AD ora lo vede il titolare nella sua pagina (lib/agenzia/lavoro-dell-ordine.ts)
  // senza che SDG lo abbia controllato prima: passa dalle stesse regole del sito e dell'analisi dell'ordine (niente
  // prezzi, telefoni, indirizzi web, «@profili», voti o recensioni di Google, nomi di persona). Gli orari no: un
  // evento in città («dalle 8 alle 13») si può scrivere. Hashtag e nome del locale si tolgono prima del controllo.
  const nomeRe = nome.length >= 2 ? new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
  // Gli orari («alle 21.00») si tolgono prima: per la regola dei prezzi «21.00» sembra un prezzo. Nell'intestazione si
  // tolgono anche i profili del locale («@caffe_di_piacenza» in canali e tono): sono suoi, non persone citate.
  const mostrabile = (t: string | null, intestazione = false) => {
    let senza = (t ?? '').replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/\b\d{1,2}[.:]\d{2}\b/g, ' ');
    if (intestazione) senza = senza.replace(/[@＠][\p{L}\d_.]+/gu, ' ');
    const x = (nomeRe ? senza.split(nomeRe).join(' il locale ') : senza).replace(/\s+/g, ' ').trim();
    return !x || (!!fraseMostrabile(x, 1, 10_000) && !haUnNomeDiPersona(x));
  };
  const daControllare = [...r.note, ...r.contenuti.flatMap((c) => [c.tema, c.didascalia, c.cosa_riprendere, c.in_citta])];
  const intestazione = [r.intestazione.canali_e_tono, r.intestazione.hashtag, r.intestazione.prima_di_pubblicare];
  if (!daControllare.every((t) => mostrabile(t)) || !intestazione.every((t) => mostrabile(t, true))) return { ok: false, motivo: 'il piano dell’AD ha un prezzo, un contatto, un indirizzo web, un nome di persona o un dato di Google' };

  const contenuti: ContenutoDelPiano[] = [...r.contenuti]
    .sort((a, b) => (a.data === b.data ? a.ora.localeCompare(b.ora) : a.data.localeCompare(b.data)))
    .map((c) => ({
      data: c.data, ora: c.ora, tipo: c.tipo, tema: c.tema, stato: 'Idea' as const,
      didascalia: c.didascalia, cosaRiprendere: c.cosa_riprendere,
      inCitta: c.fonte_evento ? c.in_citta : null, fonteEvento: c.in_citta ? c.fonte_evento : null,
    }));
  return {
    ok: true,
    piano: {
      origine: 'ad',
      periodo: partenza.periodo,
      intestazione: {
        cliente: partenza.intestazione.cliente,
        abbonamento: partenza.intestazione.abbonamento,
        canaliETono: r.intestazione.canali_e_tono,
        hashtag: r.intestazione.hashtag,
        primaDiPubblicare: r.intestazione.prima_di_pubblicare,
      },
      contenuti,
      note: r.note,
    },
  };
}

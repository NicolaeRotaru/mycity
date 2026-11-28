import { z } from 'zod';
import { FASCE } from '@/lib/agenti/fasce';
import type { Abbonamento } from './preventivo';
import { fonteDiGoogle, fraseMostrabile } from './rapporto';
import { haUnNomeDiPersona } from './nomi-di-persona';
import { AZIONI_PULSANTE, BISOGNI_SITO, NEL_SITO, PULSANTI_DEL_BISOGNO, TITOLI_BISOGNI, type AzionePulsante, type BisogniDelSito, type BisognoSito } from './bisogni-del-sito';
import { TETTI_FLUSSO_14, type dallaSchedaDellAgente } from './piano-completo-ad';

/**
 * LA BOZZA DEL SITO DELL'ORDINE, CHIESTA ALL'AD — 28/11/2026.
 *
 * Nicola, 28/11 verso le 00:55: «fai in modo che una volta che il cliente accetta viene creato in automatico, in base
 * all'abbonamento, il suo sito web, il piano editoriale, l'analisi di business». Il piano c'era già
 * (lib/agenzia/piano-completo-ad.ts); qui c'è la bozza del sito, sulla stessa strada: il flusso n8n 14 così com'è,
 * la routine «90 · Chiedi all'AD», nessuna API di IA a pagamento.
 *
 * La fascia decide le pagine (`PAGINE_PER_FASCIA`): una sola nel Base, di più nel Business e nel Premium. Sono un
 * contratto come le quantità del piano: una risposta con un numero diverso di pagine si scarta.
 * 28/11/2026, 01:10 — I BISOGNI scelti dall'agente (lib/agenzia/bisogni-del-sito.ts) decidono le sezioni e i
 * pulsanti: ogni bisogno ha almeno una sezione segnata col suo nome, e prenotazioni e vendita online hanno il loro
 * pulsante. La nota dell'agente è un'indicazione, mai un testo da pubblicare.
 *
 * Gli stessi divieti della porta di oggi (lib/agenzia/bozza-sito-ad.ts), più stretti: niente prezzi, niente
 * telefoni, email, indirizzi web, orari, nomi di persona, voti o recensioni di Google (`fraseMostrabile` del rapporto
 * dell'imprenditore, più `haUnNomeDiPersona`). Il sito non li ha mai passati all'AD: se compaiono, sono inventati. Ogni testo è «da
 * confermare». La bozza NON va online da sola: la pubblica SDG solo dopo il sì del titolare e di SDG.
 */

/** Le pagine della bozza, per fascia (FASCE.*.inPratica.sito: «Una pagina», «Più pagine», «Più pagine, aggiornato ogni mese»). */
export const PAGINE_PER_FASCIA: Record<Abbonamento, number> = { base: 1, business: 3, premium: 5 };

/** Le pagine suggerite all'AD, nell'ordine; il Base mette tutto nella pagina unica. */
const PAGINE_SUGGERITE: Record<Abbonamento, string> = {
  base: 'una sola pagina, «Home», con le sezioni Chi siamo, Cosa offriamo, Dove siamo, Contatti',
  business: '«Home», «Chi siamo e cosa offriamo», «Dove siamo e contatti»',
  premium: '«Home», «Chi siamo», «Cosa offriamo», «Novità del mese», «Dove siamo e contatti»',
};

export const COMPITO_SITO = `Sei l'AD digitale di MyCity. SDG Agenzia (il partner di MyCity per siti, social, foto e video) ha un cliente nuovo: il titolare ha appena confermato l'abbonamento. Scrivi la BOZZA DEL SITO del locale. Il titolare la vede come bozza e la conferma con SDG alla prima visita: niente va online prima del suo sì e di quello di SDG.

COSA HAI, in «dati»: il locale (nome, tipo, città, indirizzo pubblico), l'abbonamento con il NUMERO DI PAGINE, le pagine suggerite, i BISOGNI del sito scelti dall'agente col titolare (e cosa vuol dire ognuno), la nota dell'agente se c'è, e quello che hai già scritto nella scheda per il venditore (cosa ha, cosa manca, reputazione, social, cosa faremo con questa fascia). Usali: non rifare la scheda.

LE PAGINE SONO UN CONTRATTO: esattamente «pagine» pagine, non di più e non di meno. Ogni pagina ha un titolo, un percorso («/», «/chi-siamo», minuscolo, senza spazi; la prima è sempre «/») e da 1 a 5 sezioni con titolo e testo.

I BISOGNI DECIDONO LE SEZIONI E I PULSANTI: la fascia dice quante pagine, i bisogni dicono cosa c'è dentro. Per OGNI bisogno in «dati.bisogni» almeno una sezione ha «bisogno» uguale alla sua chiave (le altre sezioni hanno «bisogno» null). In «pulsanti» metti i pulsanti del sito: se c'è «prenotazioni» almeno uno fra «chiama», «whatsapp», «chat», «prenota»; se c'è «vendere_online» il pulsante «vetrina». Le etichette sono brevi («Prenota un tavolo»); numeri e collegamenti li mette SDG. La «nota_dell_agente» è un'indicazione per te: non copiarla nel sito.

LE REGOLE, che non si rompono mai:
- MAI prezzi, nemmeno indicativi: li scrive il titolare.
- MAI telefoni, email, indirizzi web, orari di apertura: non li hai, quindi sarebbero inventati. Dove servono scrivi «da confermare col titolare» a parole (per esempio «Orari: da confermare col titolare»).
- MAI voti, stelle o numero di recensioni di Google o TripAdvisor, MAI testi o nomi di chi scrive le recensioni.
- MAI nomi di persone (titolare, dipendenti, clienti): solo il nome del locale.
- MAI dati inventati: prodotti, servizi, storia del locale solo se li hai nei dati. Se non li hai, scrivi una frase generale per quel tipo di locale e mettila fra le cose «da_confermare».
- Mai superlativi che non si possono provare («il migliore», «l'unico»). Niente gioco (Sisal, scommesse) né tabacco.
- Ogni testo è una proposta: ogni sezione ha «stato» = «da_confermare».

COME SCRIVERE: italiano semplice, frasi di al massimo 25 parole, il tono del locale. Testo di una sezione: da 20 a 900 caratteri. In «da_confermare» al massimo 8 cose da chiedere al titolare alla visita (voce e perché). In «fonti» solo indirizzi https che hai davvero letto, mai pagine di Google o TripAdvisor. In «note» al massimo 4 righe per il team (foto da fare alla visita, cosa manca).

In «risultato» metti l'oggetto che rispetta lo schema.`;

const s = { type: 'string' } as const;

export const SCHEMA_SITO = {
  type: 'object',
  required: ['sottotitolo', 'pagine', 'pulsanti', 'da_confermare', 'fonti', 'note'],
  properties: {
    sottotitolo: { ...s, description: 'una riga sotto il nome del locale, al massimo 140 caratteri' },
    pagine: {
      type: 'array', minItems: 1, maxItems: 5,
      items: {
        type: 'object',
        required: ['titolo', 'percorso', 'sezioni'],
        properties: {
          titolo: s,
          percorso: { ...s, description: '«/» per la prima, poi «/chi-siamo» ecc.' },
          sezioni: {
            type: 'array', minItems: 1, maxItems: 5,
            items: { type: 'object', required: ['titolo', 'testo', 'stato', 'bisogno'], properties: { titolo: s, testo: s, stato: { enum: ['da_confermare'] }, bisogno: { enum: [...BISOGNI_SITO, null] } } },
          },
        },
      },
    },
    pulsanti: { type: 'array', maxItems: 4, items: { type: 'object', required: ['etichetta', 'azione'], properties: { etichetta: s, azione: { enum: [...AZIONI_PULSANTE] } } } },
    da_confermare: { type: 'array', maxItems: 8, items: { type: 'object', required: ['voce', 'perche'], properties: { voce: s, perche: s } } },
    fonti: { type: 'array', maxItems: 10, items: s },
    note: { type: 'array', maxItems: 4, items: s },
  },
} as const;

/** I dati per l'AD: mai l'email del titolare o dell'agente, mai l'ora della visita. */
export function datiPerIlSito(input: { nome: string; tipo: string; citta: string; indirizzo: string | null; fascia: Abbonamento; scheda: ReturnType<typeof dallaSchedaDellAgente>; bisogni?: BisogniDelSito }) {
  const f = FASCE[input.fascia];
  const bisogni = input.bisogni?.bisogni.length ? input.bisogni.bisogni : (['farsi_trovare'] as BisognoSito[]);
  const dati = {
    locale: { nome: input.nome.slice(0, 120), tipo: input.tipo.slice(0, 120), citta: input.citta.slice(0, 60), indirizzo: input.indirizzo ? input.indirizzo.slice(0, 200) : null },
    abbonamento: { fascia: input.fascia, nome: f.nome, sito: f.inPratica.sito, pagine: PAGINE_PER_FASCIA[input.fascia], pagine_suggerite: PAGINE_SUGGERITE[input.fascia] },
    bisogni: bisogni.map((b) => ({ bisogno: b, titolo: TITOLI_BISOGNI[b], nel_sito: NEL_SITO[b] })),
    nota_dell_agente: input.bisogni?.nota ?? null,
    dalla_scheda_del_venditore: input.scheda,
  };
  const misura = (x: unknown) => JSON.stringify({ compito: COMPITO_SITO, dati: x, schema: SCHEMA_SITO }).length;
  return misura(dati) <= TETTI_FLUSSO_14.richiesta ? dati : { ...dati, dalla_scheda_del_venditore: null };
}

// ———————————————————————————————— la risposta dell'AD, controllata

/** La bozza del sito come si salva nell'ordine (colonna `sito` della 999h) e come la vedono SDG e il titolare. */
export type SezioneDellaBozza = { titolo: string; testo: string; stato: 'da_confermare'; bisogno?: BisognoSito | null };
export type PaginaDellaBozza = { titolo: string; percorso: string; sezioni: SezioneDellaBozza[] };
export type BozzaSitoOrdine = {
  origine: 'ad';
  fascia: Abbonamento;
  sottotitolo: string;
  pagine: PaginaDellaBozza[];
  /** I bisogni per cui è stata scritta (scelti dall'agente) e i pulsanti che il sito avrà: numeri e collegamenti li mette SDG. */
  bisogni?: BisognoSito[];
  pulsanti?: { etichetta: string; azione: AzionePulsante }[];
  daConfermare: { voce: string; perche: string }[];
  fonti: string[];
  note: string[];
  /** Sempre falso: la bozza va online solo dopo il sì del titolare e di SDG, e la pubblica una persona. */
  pubblicata: false;
};

const corto = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const testo = (min: number, max: number) => z.string().transform(corto).pipe(z.string().min(min).max(max));
const percorso = z.string().regex(/^\/[a-z0-9-]{0,40}$/);

const RispostaSito = z.object({
  sottotitolo: testo(3, 140),
  pagine: z.array(z.object({
    titolo: testo(2, 60),
    percorso,
    sezioni: z.array(z.object({ titolo: testo(2, 80), testo: testo(20, 900), stato: z.literal('da_confermare'), bisogno: z.enum(BISOGNI_SITO).nullable().optional() })).min(1).max(5),
  })).min(1).max(5),
  pulsanti: z.array(z.object({ etichetta: testo(2, 40), azione: z.enum(AZIONI_PULSANTE) })).max(4).default([]),
  da_confermare: z.array(z.object({ voce: testo(2, 120), perche: testo(2, 300) })).max(8),
  fonti: z.array(z.string().max(500).regex(/^https:\/\/[^\s"'<>]+$/)).max(10),
  note: z.array(testo(2, 300)).max(4),
});

export type EsitoSito = { ok: true; sito: BozzaSitoOrdine } | { ok: false; motivo: string };

const VIETATI = /\b(sisal|scommess\w*|gratta e vinci|superenalotto|tabacc\w*|sigarett\w*|sigar[oi])\b/i;

/**
 * La risposta dell'AD diventa la bozza dell'ordine solo se rispetta tutto: le pagine della fascia, nessun prezzo,
 * nessun contatto o orario inventato, nessun dato di Google, nessun nome di persona. Altrimenti si scarta intera,
 * col motivo, e SDG può richiederla.
 */
export function sitoDallaRisposta(grezza: unknown, fascia: Abbonamento, nomeLocale: string, bisogniScelti: readonly BisognoSito[] = []): EsitoSito {
  const letta = RispostaSito.safeParse(grezza);
  if (!letta.success) return { ok: false, motivo: `la bozza del sito dell’AD non ha la forma giusta (${letta.error.issues[0]?.path.join('.') || 'risposta'})` };
  const r = letta.data;
  const attese = PAGINE_PER_FASCIA[fascia];
  if (r.pagine.length !== attese) return { ok: false, motivo: `la bozza del sito dell’AD ha ${r.pagine.length} pagine invece di ${attese}, quante ne dà il ${FASCE[fascia].nome}` };
  if (r.pagine[0].percorso !== '/') return { ok: false, motivo: 'la prima pagina della bozza del sito non è la home («/»)' };
  if (new Set(r.pagine.map((p) => p.percorso)).size !== r.pagine.length) return { ok: false, motivo: 'la bozza del sito ha due pagine con lo stesso percorso' };

  // I bisogni scelti dall'agente: ognuno ha la sua sezione, e i pulsanti che chiede.
  const coperti = new Set(r.pagine.flatMap((p) => p.sezioni.map((x) => x.bisogno)).filter(Boolean));
  const scoperti = bisogniScelti.filter((b) => !coperti.has(b));
  if (scoperti.length) return { ok: false, motivo: `la bozza del sito dell’AD non ha una sezione per: ${scoperti.map((b) => TITOLI_BISOGNI[b]).join(', ')}` };
  const azioni = new Set(r.pulsanti.map((p) => p.azione));
  const senzaPulsante = bisogniScelti.filter((b) => PULSANTI_DEL_BISOGNO[b] && !PULSANTI_DEL_BISOGNO[b]!.some((a) => azioni.has(a)));
  if (senzaPulsante.length) return { ok: false, motivo: `la bozza del sito dell’AD non ha il pulsante per: ${senzaPulsante.map((b) => TITOLI_BISOGNI[b]).join(', ')}` };

  // Ogni frase che il titolare legge passa dalle regole del rapporto. Il nome del locale si toglie prima del
  // controllo: «Bar 2.0» o «Pizzeria Mario Rossi» possono chiamarsi così, la regola guarda il resto del testo.
  const nome = nomeLocale.trim().toLowerCase();
  const senzaNome = (t: string) => (nome.length >= 2 ? t.split(new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(' il locale ') : t);
  // Le lunghezze le ha già controllate lo schema: qui si guarda solo cosa dice il testo.
  const frasi: { dove: string; t: string }[] = [
    { dove: 'sottotitolo', t: r.sottotitolo },
    ...r.pagine.flatMap((p, i) => [
      { dove: `pagina ${i + 1}`, t: p.titolo },
      ...p.sezioni.flatMap((x, j) => [{ dove: `pagina ${i + 1}, sezione ${j + 1}`, t: x.titolo }, { dove: `pagina ${i + 1}, sezione ${j + 1}`, t: x.testo }]),
    ]),
    ...r.da_confermare.flatMap((d, i) => [{ dove: `da confermare ${i + 1}`, t: d.voce }, { dove: `da confermare ${i + 1}`, t: d.perche }]),
    ...r.note.map((n, i) => ({ dove: `nota ${i + 1}`, t: n })),
    ...r.pulsanti.map((p, i) => ({ dove: `pulsante ${i + 1}`, t: p.etichetta })),
  ];
  for (const f of frasi) {
    const pulita = senzaNome(f.t);
    if (!fraseMostrabile(pulita, 1, 10_000) || haUnNomeDiPersona(pulita)) {
      return { ok: false, motivo: `la bozza del sito dell’AD ha un prezzo, un contatto, un orario, un indirizzo web, un nome di persona o un dato di Google (${f.dove})` };
    }
    if (VIETATI.test(pulita)) return { ok: false, motivo: `la bozza del sito dell’AD nomina gioco o tabacco (${f.dove})` };
  }
  if (r.fonti.some(fonteDiGoogle)) return { ok: false, motivo: 'la bozza del sito dell’AD cita una pagina di Google o TripAdvisor come fonte' };

  return {
    ok: true,
    sito: {
      origine: 'ad',
      fascia,
      sottotitolo: r.sottotitolo,
      pagine: r.pagine.map((p) => ({ titolo: p.titolo, percorso: p.percorso, sezioni: p.sezioni.map((x) => ({ titolo: x.titolo, testo: x.testo, stato: 'da_confermare' as const, bisogno: x.bisogno ?? null })) })),
      bisogni: [...bisogniScelti],
      pulsanti: r.pulsanti,
      daConfermare: r.da_confermare,
      fonti: r.fonti,
      note: r.note,
      pubblicata: false,
    },
  };
}

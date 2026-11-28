import { z } from 'zod';
import { FASCE } from '@/lib/agenti/fasce';
import type { Abbonamento } from './preventivo';
import { fonteDiGoogle, fraseMostrabile } from './rapporto';
import { haUnNomeDiPersona } from './nomi-di-persona';
import { TETTI_FLUSSO_14, type dallaSchedaDellAgente } from './piano-completo-ad';
import { STANDARD } from './sito-finito/standard';
import { DISEGNI } from './sito-finito/disegni';
import { PALETTE_NOMI, disegnoValido, type ContenutoSito, type Palette } from './sito-finito/contenuto';

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
 *
 * Gli stessi divieti della porta di oggi (lib/agenzia/bozza-sito-ad.ts), più stretti: niente prezzi, niente
 * telefoni, email, indirizzi web, orari, nomi di persona, voti o recensioni di Google (`fraseMostrabile` del rapporto
 * dell'imprenditore, più `haUnNomeDiPersona`). Il sito non li ha mai passati all'AD: se compaiono, sono inventati.
 *
 * 28/11/2026 verso le 14:10 — Nicola: «deve essere già su Vercel il sito del cliente che ha accettato». Da qui il sito
 * va online da solo appena l'AD lo scrive (rotta app/sito, lib/agenzia/sito-finito). Per questo l'AD scrive testi
 * finiti; le frasi da bozza rimaste nei siti di prima le toglie `testoPubblico` prima di mostrarle.
 */

/** Le pagine della bozza, per fascia (FASCE.*.inPratica.sito: «Una pagina», «Più pagine», «Più pagine, aggiornato ogni mese»). */
export const PAGINE_PER_FASCIA: Record<Abbonamento, number> = { base: 1, business: 3, premium: 5 };

export const COMPITO_SITO = `Sei l'AD digitale di MyCity. Un'attività di Piacenza ha appena confermato l'abbonamento: scrivi i contenuti del suo SITO. Il sito va online da solo appena li scrivi: lo costruisce il sito di MyCity, con la grafica, i disegni e le pagine dello standard del suo abbonamento (in «dati.abbonamento.standard» le pagine e le sezioni). Ogni testo è finito, come sul sito vero di un bel locale: il titolare lo vede online e ci dice cosa cambiare.

COSA HAI, in «dati»: il locale (nome, tipo, città, indirizzo pubblico), l'abbonamento con lo standard, la «nota_dell_agente» se c'è (un'indicazione per te, per esempio «vuole far vedere la sala per le feste»: non copiarla nel sito), e quello che hai già scritto nella scheda per il venditore (cosa ha, cosa manca, reputazione, social). Usali: non rifare la scheda.

COSA SCRIVI, nel campo «contenuto»:
- occhiello: da 2 a 4 parole separate da « · », in minuscolo, su cosa si fa (per esempio «colazioni · pranzi · aperitivi»).
- titolo: il titolo della copertina, che racconta il posto in poche parole (per esempio «Il bar rosa di Piazza Duomo»), non il solo nome. Al massimo 70 caratteri.
- sottotitolo: una o due frasi che fanno venire voglia di passare.
- momenti_titolo, momenti_intro e momenti: ESATTAMENTE 3 schede (titolo, testo, disegno) sui momenti della giornata o sulle cose principali che si fanno lì.
- disegno, nei momenti e nell'offerta, è uno di: tazza, cornetto, panino, calice, vino, pizza, gelato, torta, pane, fiore, borsa, forbici, stella.
- perche: 3 motivi veri per venire (dove si trova, cosa offre, il carattere del posto).
- locale: un titolo e da 1 a 3 paragrafi sul posto e la sua atmosfera.
- offerta: da 2 a 6 categorie (categoria, descrizione, voci, disegno). Nelle «voci» SOLO i prodotti che sono nei dati; se non li hai, lascia la lista vuota e descrivi la categoria in generale.
- citta: un titolo, 1 o 2 paragrafi sulla zona (fatti veri che vengono dall'indirizzo: la piazza, la via) e in «vicino» fino a 5 luoghi noti a due passi.
- come_arrivare: una frase su dove si trova.
- novita: SOLO nel Premium (negli altri null). Un titolo e 1 o 2 paragrafi sul mese, senza eventi né offerte inventati.
- domande: SOLO nel Premium (negli altri []). Fino a 6 domande con risposte che conosci davvero dai dati (dove siete, cosa si trova); mai orari, prezzi o servizi che non sai.
- palette: una di crema, rosa, verde, blu, terracotta, oro: quella che somiglia al locale (un bar rosa → rosa); senza indizi, crema.

LE REGOLE, che non si rompono mai:
- MAI prezzi, nemmeno indicativi: li scrive il titolare.
- MAI telefoni, email, indirizzi web, orari di apertura: non li hai, quindi sarebbero inventati. Non parlarne affatto: indirizzo, telefono, orari, mappa e social li aggiunge il sito da solo, coi dati veri del negozio.
- MAI frasi da bozza: niente «da confermare», «il titolare», «sarà inserito», «metteremo», «dopo la conferma». Il sito è già online e il visitatore non deve leggere promesse a metà.
- MAI voti, stelle o numero di recensioni di Google o TripAdvisor, MAI testi o nomi di chi scrive le recensioni.
- MAI nomi di persone (titolare, dipendenti, clienti): solo il nome del locale.
- MAI dati inventati: prodotti, servizi, storia del locale solo se li hai nei dati. Se non li hai, scrivi una frase generale e vera per quel tipo di locale, senza dire che manca qualcosa, e metti fra le cose «da_confermare» cosa chiedere al titolare.
- Mai superlativi che non si possono provare («il migliore», «l'unico»). Niente gioco (Sisal, scommesse) né tabacco.

COME SCRIVERE: italiano semplice e caldo, frasi di al massimo 25 parole, il tono del locale. Sottotitolo fuori dal contenuto: una riga per SDG, al massimo 140 caratteri. In «da_confermare» al massimo 8 cose da chiedere al titolare alla visita (voce e perché: orari, telefono, il menu vero, le foto). In «fonti» solo indirizzi https che hai davvero letto, mai pagine di Google o TripAdvisor. In «note» al massimo 4 righe per il team.

In «risultato» metti l'oggetto che rispetta lo schema.`;

const s = { type: 'string' } as const;

export const SCHEMA_SITO = {
  type: 'object',
  required: ['sottotitolo', 'contenuto', 'da_confermare', 'fonti', 'note'],
  properties: {
    sottotitolo: { ...s, description: 'una riga per SDG, al massimo 140 caratteri' },
    contenuto: {
      type: 'object',
      required: ['occhiello', 'titolo', 'sottotitolo', 'momenti_titolo', 'momenti_intro', 'momenti', 'perche', 'locale', 'offerta', 'citta', 'come_arrivare', 'novita', 'domande', 'palette'],
      properties: {
        occhiello: s, titolo: s, sottotitolo: s, momenti_titolo: s, momenti_intro: s,
        momenti: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', required: ['titolo', 'testo', 'disegno'], properties: { titolo: s, testo: s, disegno: { enum: [...DISEGNI] } } } },
        perche: { type: 'array', maxItems: 3, items: { type: 'object', required: ['titolo', 'testo'], properties: { titolo: s, testo: s } } },
        locale: { type: ['object', 'null'], required: ['titolo', 'paragrafi'], properties: { titolo: s, paragrafi: { type: 'array', maxItems: 3, items: s } } },
        offerta: { type: 'array', maxItems: 6, items: { type: 'object', required: ['categoria', 'descrizione', 'voci', 'disegno'], properties: { categoria: s, descrizione: s, voci: { type: 'array', maxItems: 12, items: s }, disegno: { enum: [...DISEGNI] } } } },
        citta: { type: ['object', 'null'], required: ['titolo', 'paragrafi', 'vicino'], properties: { titolo: s, paragrafi: { type: 'array', maxItems: 2, items: s }, vicino: { type: 'array', maxItems: 5, items: s } } },
        come_arrivare: { type: ['string', 'null'] },
        novita: { type: ['object', 'null'], required: ['titolo', 'paragrafi'], properties: { titolo: s, paragrafi: { type: 'array', maxItems: 2, items: s } } },
        domande: { type: 'array', maxItems: 6, items: { type: 'object', required: ['domanda', 'risposta'], properties: { domanda: s, risposta: s } } },
        palette: { enum: [...PALETTE_NOMI] },
      },
    },
    da_confermare: { type: 'array', maxItems: 8, items: { type: 'object', required: ['voce', 'perche'], properties: { voce: s, perche: s } } },
    fonti: { type: 'array', maxItems: 10, items: s },
    note: { type: 'array', maxItems: 4, items: s },
  },
} as const;

/** I dati per l'AD: mai l'email del titolare o dell'agente, mai l'ora della visita. */
export function datiPerIlSito(input: { nome: string; tipo: string; citta: string; indirizzo: string | null; fascia: Abbonamento; scheda: ReturnType<typeof dallaSchedaDellAgente>; nota?: string | null }) {
  const f = FASCE[input.fascia];
  const dati = {
    locale: { nome: input.nome.slice(0, 120), tipo: input.tipo.slice(0, 120), citta: input.citta.slice(0, 60), indirizzo: input.indirizzo ? input.indirizzo.slice(0, 200) : null },
    abbonamento: { fascia: input.fascia, nome: f.nome, sito: f.inPratica.sito, standard: STANDARD[input.fascia].map((p) => ({ pagina: p.titolo, sezioni: p.sezioni, ...(p.facoltativa ? { facoltativa: true } : {}) })) },
    nota_dell_agente: input.nota ?? null,
    dalla_scheda_del_venditore: input.scheda,
  };
  const misura = (x: unknown) => JSON.stringify({ compito: COMPITO_SITO, dati: x, schema: SCHEMA_SITO }).length;
  return misura(dati) <= TETTI_FLUSSO_14.richiesta ? dati : { ...dati, dalla_scheda_del_venditore: null };
}

// ———————————————————————————————— la risposta dell'AD, controllata

/** La bozza del sito come si salva nell'ordine (colonna `sito` della 999h) e come la vedono SDG e il titolare. */
export type SezioneDellaBozza = { titolo: string; testo: string; stato: 'da_confermare' };
export type PaginaDellaBozza = { titolo: string; percorso: string; sezioni: SezioneDellaBozza[] };
export type BozzaSitoOrdine = {
  origine: 'ad';
  fascia: Abbonamento;
  sottotitolo: string;
  pagine: PaginaDellaBozza[];
  /** 28/11 pomeriggio: i contenuti nella forma dello standard per abbonamento. Senza, il sito usa `pagine`. */
  contenuto?: ContenutoSito;
  daConfermare: { voce: string; perche: string }[];
  fonti: string[];
  note: string[];
  /** Campo di prima del 28/11, resta per i siti già salvati: se il sito è online lo decide la rotta app/sito. */
  pubblicata: false;
};

const corto = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const testo = (min: number, max: number) => z.string().transform(corto).pipe(z.string().min(min).max(max));
const percorso = z.string().regex(/^\/[a-z0-9-]{0,40}$/);

const disegno = z.string().max(40);
/**
 * Collaudo 28/11: lo schema mandato all'AD non dice lunghezze, e uno zod severo scartava risposte buone per una
 * parola sola («Comodo.» troppo corto, una nota troppo lunga). Qui: mai vuoto, e oltre il tetto si taglia invece di
 * buttare tutto. I divieti veri (prezzi, contatti, orari, nomi) restano severi più sotto.
 */
const pieno = (max: number) => z.string().transform(corto).pipe(z.string().min(1)).transform((t) => t.slice(0, max));
const facoltativo = (max: number) => z.string().nullable().transform((t) => (t ? corto(t).slice(0, max) : ''));
const lista = <T extends z.ZodTypeAny>(voce: T, max: number) => z.array(voce).transform((a) => a.slice(0, max));
const frasi = (max: number) => z.array(z.string()).transform((a) => a.map(corto).filter(Boolean).map((t) => t.slice(0, 700)).slice(0, max));
const ContenutoRisposta = z.object({
  occhiello: facoltativo(100),
  titolo: pieno(90),
  sottotitolo: pieno(300),
  momenti_titolo: facoltativo(90),
  momenti_intro: facoltativo(400),
  momenti: z.array(z.object({ titolo: pieno(70), testo: pieno(400), disegno })).min(1).transform((a) => a.slice(0, 3)),
  perche: lista(z.object({ titolo: pieno(70), testo: pieno(400) }), 3),
  locale: z.object({ titolo: pieno(90), paragrafi: frasi(3) }).nullable(),
  offerta: lista(z.object({ categoria: pieno(70), descrizione: facoltativo(400), voci: z.array(z.string()).transform((a) => a.map(corto).filter(Boolean).map((t) => t.slice(0, 70)).slice(0, 12)), disegno }), 6),
  citta: z.object({ titolo: pieno(90), paragrafi: frasi(2), vicino: z.array(z.string()).transform((a) => a.map(corto).filter(Boolean).map((t) => t.slice(0, 70)).slice(0, 5)) }).nullable(),
  come_arrivare: facoltativo(400),
  novita: z.object({ titolo: pieno(90), paragrafi: frasi(2) }).nullable(),
  domande: lista(z.object({ domanda: pieno(160), risposta: pieno(400) }), 6),
  palette: z.string().max(40),
});
type ContenutoLetto = z.infer<typeof ContenutoRisposta>;

/**
 * 28/11 pomeriggio — la risposta ha il `contenuto` nella forma dello standard per abbonamento; le `pagine` del primo
 * sito restano accettate (le risposte arrivate prima, le prove), con le loro regole. Almeno uno dei due.
 */
const RispostaSito = z.object({
  sottotitolo: testo(3, 140),
  pagine: z.array(z.object({
    titolo: testo(2, 60),
    percorso,
    sezioni: z.array(z.object({ titolo: testo(2, 80), testo: testo(20, 900), stato: z.literal('da_confermare') })).min(1).max(5),
  })).min(1).max(5).optional(),
  contenuto: ContenutoRisposta.optional(),
  da_confermare: z.array(z.object({ voce: testo(2, 120), perche: testo(2, 300) })).max(8),
  fonti: z.array(z.string().max(500).regex(/^https:\/\/[^\s"'<>]+$/)).max(10),
  note: z.array(testo(2, 300)).max(4),
}).refine((r) => !!r.pagine || !!r.contenuto, { message: 'servono il contenuto o le pagine', path: ['contenuto'] });

/** Il contenuto letto, nella forma che usa il sito. Novità e domande solo nel Premium. */
function contenutoDalLetto(c: ContenutoLetto, fascia: Abbonamento): ContenutoSito {
  return {
    occhiello: c.occhiello,
    titolo: c.titolo,
    sottotitolo: c.sottotitolo,
    momentiTitolo: c.momenti_titolo,
    momentiIntro: c.momenti_intro,
    momenti: c.momenti.map((m) => ({ titolo: m.titolo, testo: m.testo, disegno: disegnoValido(m.disegno, m.titolo) })),
    perche: c.perche,
    locale: c.locale && c.locale.paragrafi.length ? c.locale : null,
    offerta: c.offerta.map((o) => ({ categoria: o.categoria, descrizione: o.descrizione, voci: o.voci, disegno: disegnoValido(o.disegno, o.categoria) })),
    citta: c.citta,
    comeArrivare: c.come_arrivare || null,
    novita: fascia === 'premium' ? c.novita : null,
    domande: fascia === 'premium' ? c.domande : [],
    palette: (PALETTE_NOMI as string[]).includes(c.palette) ? (c.palette as Palette) : 'crema',
  };
}

/**
 * Dal contenuto, le pagine nella forma di prima: le legge la pagina ordini di SDG e la pagina «Sito web» del
 * titolare. Una pagina dello standard per volta, con le sue sezioni scritte come titolo e testo.
 */
export function pagineDalContenuto(c: ContenutoSito, fascia: Abbonamento): PaginaDellaBozza[] {
  const sez = (titolo: string, testo: string) => ({ titolo, testo, stato: 'da_confermare' as const });
  const perPagina: Record<string, { titolo: string; testo: string; stato: 'da_confermare' }[]> = {
    '/': [sez(c.titolo, c.sottotitolo), ...c.momenti.map((m) => sez(m.titolo, m.testo))],
    '/il-locale': c.locale ? [sez(c.locale.titolo, c.locale.paragrafi.join(' '))] : [],
    '/cosa-offriamo': c.offerta.map((o) => sez(o.categoria, [o.descrizione, o.voci.join(', ')].filter(Boolean).join(' '))),
    '/in-citta': c.citta ? [sez(c.citta.titolo, [...c.citta.paragrafi, c.citta.vicino.join(', ')].filter(Boolean).join(' '))] : [],
    '/novita': c.novita ? [sez(c.novita.titolo, c.novita.paragrafi.join(' '))] : [],
    '/domande': c.domande.map((d) => sez(d.domanda, d.risposta)),
    '/contatti': c.comeArrivare ? [sez('Come arrivare', c.comeArrivare)] : [],
  };
  return STANDARD[fascia]
    .map((p) => ({ titolo: p.titolo, percorso: p.percorso, sezioni: (perPagina[p.percorso] ?? []).filter((x) => x.testo) }))
    .filter((p) => p.sezioni.length > 0);
}

export type EsitoSito = { ok: true; sito: BozzaSitoOrdine } | { ok: false; motivo: string };

/**
 * Collaudo 28/11/2026 — Un orario di apertura («dalle 7:00 alle 20:00», «Orario: lun-sab 7-20», «alle ore 8»): il
 * sito non lo ha mai passato all'AD, quindi è inventato. `fraseMostrabile` guarda prezzi e contatti, non gli orari.
 * «Orari: da confermare col titolare», senza cifre, resta.
 */
export const ORARIO = /\b([01]?\d|2[0-3])[:.][0-5]\d\b|\b(dalle|alle)\s+(ore\s+)?([01]?\d|2[0-3])\b|\bore\s+([01]?\d|2[0-3])\b|\borari[oa]?\b[^.]*\d/i;

/**
 * Collaudo 28/11 — gli orari scritti in altri modi: «Aperti 7-20», «Lun-sab 7/19», «dalle sette». Anche questi il
 * sito non li ha mai dati all'AD.
 */
export const ORARIO_A_PAROLE = /\b(apert[oi]|apriamo|chiudiamo|lun\w*|mar\w*|mer\w*|gio\w*|ven\w*|sab\w*|dom\w*)\b[^.]{0,24}?\b([01]?\d|2[0-3])\s*[-–/]\s*([01]?\d|2[0-3])\b|\b(dalle|alle)\s+(ore\s+)?(sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|ventuno|ventidue|ventitré)\b/i;

const VIETATI = /\b(sisal|snai|lottomatica|eurobet|goldbet|scommess\w*|gratta e vinci|superenalotto|tabacc\w*|sigarett\w*|sigar[oi])\b/i;

/**
 * La risposta dell'AD diventa la bozza dell'ordine solo se rispetta tutto: le pagine della fascia, nessun prezzo,
 * nessun contatto o orario inventato, nessun dato di Google, nessun nome di persona. Altrimenti si scarta intera,
 * col motivo, e SDG può richiederla.
 */
/** Ogni testo del contenuto che il visitatore legge: passa dalle stesse regole delle pagine. */
function testiDelContenuto(c: ContenutoSito): string[] {
  return [
    c.occhiello, c.titolo, c.sottotitolo, c.momentiTitolo, c.momentiIntro,
    ...c.momenti.flatMap((m) => [m.titolo, m.testo]),
    ...c.perche.flatMap((m) => [m.titolo, m.testo]),
    ...(c.locale ? [c.locale.titolo, ...c.locale.paragrafi] : []),
    ...c.offerta.flatMap((o) => [o.categoria, o.descrizione, ...o.voci]),
    ...(c.citta ? [c.citta.titolo, ...c.citta.paragrafi, ...c.citta.vicino] : []),
    c.comeArrivare ?? '',
    ...(c.novita ? [c.novita.titolo, ...c.novita.paragrafi] : []),
    ...c.domande.flatMap((d) => [d.domanda, d.risposta]),
  ].filter((t) => t && t.trim());
}

export function sitoDallaRisposta(grezza: unknown, fascia: Abbonamento, nomeLocale: string): EsitoSito {
  const letta = RispostaSito.safeParse(grezza);
  if (!letta.success) return { ok: false, motivo: `la bozza del sito dell’AD non ha la forma giusta (${letta.error.issues[0]?.path.join('.') || 'risposta'})` };
  const r = letta.data;
  const contenuto = r.contenuto ? contenutoDalLetto(r.contenuto, fascia) : null;
  if (!contenuto && r.pagine) {
    const attese = PAGINE_PER_FASCIA[fascia];
    if (r.pagine.length !== attese) return { ok: false, motivo: `la bozza del sito dell’AD ha ${r.pagine.length} pagine invece di ${attese}, quante ne dà il ${FASCE[fascia].nome}` };
    if (r.pagine[0].percorso !== '/') return { ok: false, motivo: 'la prima pagina della bozza del sito non è la home («/»)' };
    if (new Set(r.pagine.map((p) => p.percorso)).size !== r.pagine.length) return { ok: false, motivo: 'la bozza del sito ha due pagine con lo stesso percorso' };
  }
  const pagine: PaginaDellaBozza[] = contenuto ? pagineDalContenuto(contenuto, fascia) : (r.pagine ?? []).map((p) => ({ titolo: p.titolo, percorso: p.percorso, sezioni: p.sezioni.map((x) => ({ titolo: x.titolo, testo: x.testo, stato: 'da_confermare' as const })) }));

  // Ogni frase che il titolare legge passa dalle regole del rapporto. Il nome del locale si toglie prima del
  // controllo: «Bar 2.0» o «Pizzeria Mario Rossi» possono chiamarsi così, la regola guarda il resto del testo.
  const nome = nomeLocale.trim().toLowerCase();
  const senzaNome = (t: string) => (nome.length >= 2 ? t.split(new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(' il locale ') : t);
  // Le lunghezze le ha già controllate lo schema: qui si guarda solo cosa dice il testo.
  const frasi: { dove: string; t: string }[] = [
    { dove: 'sottotitolo', t: r.sottotitolo },
    ...pagine.flatMap((p, i) => [
      { dove: `pagina ${i + 1}`, t: p.titolo },
      ...p.sezioni.flatMap((x, j) => [{ dove: `pagina ${i + 1}, sezione ${j + 1}`, t: x.titolo }, { dove: `pagina ${i + 1}, sezione ${j + 1}`, t: x.testo }]),
    ]),
    ...(contenuto ? testiDelContenuto(contenuto).map((t, i) => ({ dove: `contenuto ${i + 1}`, t })) : []),
    ...r.da_confermare.flatMap((d, i) => [{ dove: `da confermare ${i + 1}`, t: d.voce }, { dove: `da confermare ${i + 1}`, t: d.perche }]),
    ...r.note.map((n, i) => ({ dove: `nota ${i + 1}`, t: n })),
  ];
  for (const f of frasi) {
    const pulita = senzaNome(f.t);
    if (!fraseMostrabile(pulita, 1, 10_000) || haUnNomeDiPersona(pulita)) {
      return { ok: false, motivo: `la bozza del sito dell’AD ha un prezzo, un contatto, un orario, un indirizzo web, un nome di persona o un dato di Google (${f.dove})` };
    }
    if (ORARIO.test(pulita) || ORARIO_A_PAROLE.test(pulita)) return { ok: false, motivo: `la bozza del sito dell’AD ha un orario di apertura, che non le abbiamo dato (${f.dove})` };
    if (VIETATI.test(pulita)) return { ok: false, motivo: `la bozza del sito dell’AD nomina gioco o tabacco (${f.dove})` };
  }
  if (r.fonti.some(fonteDiGoogle)) return { ok: false, motivo: 'la bozza del sito dell’AD cita una pagina di Google o TripAdvisor come fonte' };

  return {
    ok: true,
    sito: {
      origine: 'ad',
      fascia,
      sottotitolo: r.sottotitolo,
      pagine,
      ...(contenuto ? { contenuto } : {}),
      daConfermare: r.da_confermare,
      fonti: r.fonti,
      note: r.note,
      pubblicata: false,
    },
  };
}

import { z } from 'zod';
import { FASCE } from '@/lib/agenti/fasce';
import type { Abbonamento } from './preventivo';
import { ANALISI_PER_FASCIA, PARTI_RAPPORTO, TITOLI_PARTI, fonteDiGoogle, fraseMostrabile, partiDellaFascia, type ParteRapporto } from './rapporto';
import { TETTI_FLUSSO_14, type dallaSchedaDellAgente } from './piano-completo-ad';
import { haUnNomeDiPersona } from './nomi-di-persona';

/**
 * L'ANALISI DEL BUSINESS ALL'AVVIO, CHIESTA ALL'AD — 28/11/2026.
 *
 * Nicola, 28/11 verso le 00:55: all'accettazione nasce in automatico, in base all'abbonamento, anche «l'analisi di
 * business». Qui c'è il rapporto «all'avvio», uguale per tutte le fasce come ritmo (una volta), con le sole parti che
 * la fascia comprende (ANALISI_PER_FASCIA del rapporto dell'imprenditore). Il ritmo mensile del Business e quello
 * settimanale del Premium sono il secondo passo e non stanno qui.
 *
 * Strada: il flusso n8n 14 così com'è, la routine «90 · Chiedi all'AD», nessuna API a pagamento.
 *
 * LE REGOLE LEGALI di lib/agenzia/rapporto.ts (parere del 26/11 sui termini di Google Maps): voto, numero di
 * recensioni, orari, testi delle recensioni, nome e indirizzo letti su Google NON si salvano e non si scrivono.
 * Ogni frase passa da `fraseMostrabile` (niente prezzi, contatti, indirizzi web, nomi di persona, voti di Google);
 * ogni fonte è https e mai una pagina di Google o TripAdvisor. Una risposta che sbaglia si scarta intera.
 */

export const COMPITO_ANALISI = `Sei l'AD digitale di MyCity. SDG Agenzia (il partner di MyCity per siti, social, foto e video) ha un cliente nuovo: il titolare ha appena confermato l'abbonamento. Scrivi il RAPPORTO DEL BUSINESS ALL'AVVIO: dove si trova oggi il locale e cosa fare nei primi 30 giorni. Il titolare lo legge come bozza e lo rivede con SDG alla prima visita.

COSA HAI, in «dati»: il locale (nome, tipo, città, indirizzo pubblico), l'abbonamento con le PARTI del rapporto che comprende (e come), la «nota_dell_agente» se c'è (un'indicazione su dove guardare, non va copiata), e quello che hai già scritto nella scheda per il venditore. Usali: non rifare la scheda.

LE PARTI SONO UN CONTRATTO: una voce in «parti» per OGNI parte comprese in «dati.abbonamento.parti», con la sua chiave, e nessuna parte esclusa. Ogni parte ha da 1 a 5 frasi e le sue fonti. Se di una parte non sai niente di vero, una sola frase: «Lo leggiamo insieme alla prima visita.»

SOLO DATI PUBBLICI E VERI: puoi fare al massimo 4 ricerche (sito del locale, i suoi social pubblici, OpenStreetMap per i concorrenti vicini, il sito del comune per eventi e bandi). Meglio vuoto che inventato.

LE REGOLE LEGALI, che non si rompono mai:
- MAI voti, stelle, numero di recensioni, orari, testi di recensioni letti su Google Maps o TripAdvisor, e mai una loro pagina fra le fonti. La reputazione solo per temi («il servizio», «i dolci»), senza numeri.
- MAI nomi di persone (titolare, dipendenti, clienti, chi recensisce), mai «@profili» di altri.
- MAI prezzi, telefoni, email, indirizzi web dentro le frasi: gli indirizzi stanno solo in «fonti».
- Mai superlativi che non si possono provare. Niente gioco né tabacco.

LO STANDARD è l'analisi di mercato che SDG Agenzia ha fatto per se stessa (Nicola, 28/11/2026: «molto molto bella, usala come standard per tutti, personalizzata in base all'abbonamento e al cliente»). Oltre alle parti scrivi:
- «swot»: forze, debolezze, opportunità e minacce di QUESTO locale, da 1 a 4 frasi ciascuna, prese da quello che hai trovato.
- «concorrenti»: fino a «dati.abbonamento.concorrenti_al_massimo» attività vere e vicine (o che vendono le stesse cose sul web): il nome dell'attività, cosa fanno, da 1 a 3 punti forti e da 1 a 3 punti deboli, e la fonte https della loro pagina (mai Google o TripAdvisor). Mai prezzi, mai nomi di persone.
- «clienti_tipo»: da 2 a 4 tipi di cliente del locale («chi lavora in zona e passa a pranzo»), col loro bisogno e perché scelgono questo locale. Mai nomi di persone.
- «numeri_chiave»: fino a 4 numeri pubblici sulla zona o sul mercato (abitanti, attività simili vicine, un dato del comune), ognuno con la sua fonte https. Mai voti, stelle, recensioni o prezzi. Senza una fonte vera, nessun numero.
- per ogni prima mossa, «quando»: la settimana dei primi 30 giorni («settimana 1»).

COME SCRIVERE: italiano semplice, frasi di al massimo 25 parole, da 10 a 300 caratteri. «sintesi»: 2-4 frasi. «prime_mosse»: da 3 a 5 cose concrete per i primi 30 giorni, con il perché. «da_confermare»: al massimo 6 cose da chiedere al titolare.

In «risultato» metti l'oggetto che rispetta lo schema.`;

const s = { type: 'string' } as const;

export const SCHEMA_ANALISI = {
  type: 'object',
  required: ['sintesi', 'parti', 'prime_mosse', 'da_confermare'],
  properties: {
    sintesi: { type: 'array', minItems: 1, maxItems: 4, items: s },
    parti: {
      type: 'array', minItems: 1, maxItems: PARTI_RAPPORTO.length,
      items: {
        type: 'object',
        required: ['parte', 'frasi', 'fonti'],
        properties: { parte: { enum: [...PARTI_RAPPORTO] }, frasi: { type: 'array', minItems: 1, maxItems: 5, items: s }, fonti: { type: 'array', maxItems: 5, items: s } },
      },
    },
    prime_mosse: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'object', required: ['cosa', 'perche'], properties: { cosa: s, perche: s, quando: s } } },
    da_confermare: { type: 'array', maxItems: 6, items: s },
    // 28/11/2026 — Lo standard di SDG (lib/agenzia/analisi-standard.ts). Facoltativi: un'analisi senza resta valida.
    swot: { type: 'object', properties: { forze: { type: 'array', maxItems: 4, items: s }, debolezze: { type: 'array', maxItems: 4, items: s }, opportunita: { type: 'array', maxItems: 4, items: s }, minacce: { type: 'array', maxItems: 4, items: s } } },
    concorrenti: {
      type: 'array', maxItems: 8,
      items: { type: 'object', required: ['nome', 'cosa_fanno', 'punti_forti', 'punti_deboli'], properties: { nome: s, cosa_fanno: s, punti_forti: { type: 'array', maxItems: 3, items: s }, punti_deboli: { type: 'array', maxItems: 3, items: s }, fonte: s } },
    },
    clienti_tipo: { type: 'array', maxItems: 4, items: { type: 'object', required: ['nome', 'bisogno'], properties: { nome: s, bisogno: s, perche: s } } },
    numeri_chiave: { type: 'array', maxItems: 4, items: { type: 'object', required: ['voce', 'valore', 'fonte'], properties: { voce: s, valore: s, fonte: s } } },
  },
} as const;

/**
 * Quanti concorrenti per fascia, dal listino: 3 vicini nel Base; nel Business in più «i tuoi 3 concorrenti principali sui
 * social e sul web» (3 + 3); nel Premium «fino a 5 concorrenti sui social e sul web» (3 + 5).
 */
export const CONCORRENTI_PER_FASCIA: Record<Abbonamento, number> = { base: 3, business: 6, premium: 8 };

/** Le parti che la fascia comprende, con «come» quando c'è, per dirle all'AD. */
export const partiDaScrivere = (fascia: Abbonamento): ParteRapporto[] => partiDellaFascia(fascia).incluse.map((r) => r.parte);

/** I dati per l'AD: mai l'email del titolare o dell'agente, mai l'ora della visita. */
export function datiPerLAnalisi(input: { nome: string; tipo: string; citta: string; indirizzo: string | null; fascia: Abbonamento; scheda: ReturnType<typeof dallaSchedaDellAgente>; nota?: string | null }) {
  const f = FASCE[input.fascia];
  const dati = {
    nota_dell_agente: input.nota ?? null,
    locale: { nome: input.nome.slice(0, 120), tipo: input.tipo.slice(0, 120), citta: input.citta.slice(0, 60), indirizzo: input.indirizzo ? input.indirizzo.slice(0, 200) : null },
    abbonamento: {
      fascia: input.fascia, nome: f.nome, analisi: f.inPratica.analisi,
      quando: 'all’avvio: questo è il primo rapporto',
      parti: partiDellaFascia(input.fascia).incluse.map((r) => ({ parte: r.parte, titolo: r.titolo, come: r.come })),
      concorrenti_al_massimo: CONCORRENTI_PER_FASCIA[input.fascia],
    },
    dalla_scheda_del_venditore: input.scheda,
  };
  const misura = (x: unknown) => JSON.stringify({ compito: COMPITO_ANALISI, dati: x, schema: SCHEMA_ANALISI }).length;
  return misura(dati) <= TETTI_FLUSSO_14.richiesta ? dati : { ...dati, dalla_scheda_del_venditore: null };
}

// ———————————————————————————————— la risposta dell'AD, controllata

export type ParteDellAnalisi = { parte: ParteRapporto; titolo: string; frasi: string[]; fonti: string[] };
/** L'analisi all'avvio come si salva nell'ordine (colonna `analisi` della 999h). */
export type AnalisiAvvioOrdine = {
  origine: 'ad';
  fascia: Abbonamento;
  quando: 'avvio';
  ritmo: string;
  sintesi: string[];
  parti: ParteDellAnalisi[];
  primeMosse: { cosa: string; perche: string; quando?: string | null }[];
  daConfermare: string[];
  /** 28/11/2026 — I pezzi dello standard di SDG: possono mancare (analisi di prima, o l'AD non li ha scritti). */
  swot?: { forze: string[]; debolezze: string[]; opportunita: string[]; minacce: string[] };
  concorrenti?: { nome: string; cosaFanno: string; puntiForti: string[]; puntiDeboli: string[]; fonte: string | null }[];
  clientiTipo?: { nome: string; bisogno: string; perche: string | null }[];
  numeriChiave?: { voce: string; valore: string; fonte: string }[];
};

const corto = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const frase = z.string().transform(corto).pipe(z.string().min(10).max(300));
const fonte = z.string().max(500).regex(/^https:\/\/[^\s"'<>]+$/);

const RispostaAnalisi = z.object({
  sintesi: z.array(frase).min(1).max(4),
  parti: z.array(z.object({ parte: z.enum(PARTI_RAPPORTO), frasi: z.array(frase).min(1).max(5), fonti: z.array(fonte).max(5) })).min(1).max(PARTI_RAPPORTO.length),
  prime_mosse: z.array(z.object({ cosa: frase, perche: frase, quando: z.string().transform(corto).pipe(z.string().min(1).max(40)).nullish().catch(null) })).min(3).max(5),
  da_confermare: z.array(frase).max(6),
  // I pezzi dello standard si leggono a parte (pezziDelloStandard): una voce sbagliata si toglie, non fa scartare l'analisi.
  swot: z.unknown().optional(),
  concorrenti: z.unknown().optional(),
  clienti_tipo: z.unknown().optional(),
  numeri_chiave: z.unknown().optional(),
});

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ogg = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const fonteBuona = (v: unknown): string | null => (typeof v === 'string' && v.length <= 500 && /^https:\/\/[^\s"'<>]+$/.test(v) && !fonteDiGoogle(v) ? v : null);
/** Un numero chiave non è mai un voto, una recensione o un prezzo (le regole legali del 26/11), coi loro sinonimi. */
const NUMERO_VIETATO = /recension|stell|\bvot[oi]\b|★|€|\beur[oi]?\b|\$|opinion|giudiz|valutaz|punteggi|gradiment|\/\s*(5|10)\b/i;
/**
 * Collaudo 28/11/2026: un voto detto senza la parola «Google» («4,5 stelle fra i clienti», «4/5», «230 opinioni»)
 * passava il controllo comune delle frasi. Nei pezzi dello standard si toglie: costa al massimo una frase (anche una
 * data come «31/5»), mai l'analisi intera.
 */
const VOTO_LARGO = /\d\s*([.,]\s*\d)?\s*stell[ae]\b|[★☆⭐]|\b\d{1,2}([.,]\d)?\s*\/\s*(5|10)\b|\d+\s*(opinion|giudiz|valutaz|punteggi|recension)/i;

/**
 * I pezzi dello standard di SDG, ognuno controllato con le stesse regole delle frasi: quello che non le rispetta si
 * toglie e basta. Il nome di un concorrente è il nome di un'attività (Nicola, 26/11: i concorrenti si nominano): passa
 * le regole su prezzi, contatti e indirizzi, non quella sui nomi di persona, che scambierebbe «Bar da Mario» per una persona.
 */
function pezziDelloStandard(r: z.infer<typeof RispostaAnalisi>, fascia: Abbonamento, va: (t: string) => boolean) {
  const testo = (v: unknown, min = 10, max = 300): string | null => {
    const t = typeof v === 'string' ? corto(v) : '';
    return t.length >= min && t.length <= max && va(t) && !VOTO_LARGO.test(t) ? t : null;
  };
  const frasi = (v: unknown, quante: number) => lista(v).map((x) => testo(x)).filter((x): x is string => !!x).slice(0, quante);
  const sw = ogg(r.swot);
  const swot = { forze: frasi(sw.forze, 4), debolezze: frasi(sw.debolezze, 4), opportunita: frasi(sw.opportunita, 4), minacce: frasi(sw.minacce, 4) };
  const concorrenti = lista(r.concorrenti).map((x) => {
    const c = ogg(x);
    const nome = typeof c.nome === 'string' ? corto(c.nome) : '';
    const cosaFanno = testo(c.cosa_fanno);
    if (nome.length < 2 || nome.length > 80 || !fraseMostrabile(nome, 2, 80) || VOTO_LARGO.test(nome) || /\b[1-5]\s*\/\s*5\b/.test(nome) || !cosaFanno) return null;
    return { nome, cosaFanno, puntiForti: frasi(c.punti_forti, 3), puntiDeboli: frasi(c.punti_deboli, 3), fonte: fonteBuona(c.fonte) };
  }).filter((x): x is NonNullable<typeof x> => !!x)
    // Un concorrente scritto due volte si tiene una volta sola.
    .filter((c, i, tutti) => tutti.findIndex((x) => x.nome.toLowerCase() === c.nome.toLowerCase()) === i)
    .slice(0, CONCORRENTI_PER_FASCIA[fascia]);
  const clientiTipo = lista(r.clienti_tipo).map((x) => {
    const c = ogg(x);
    const nome = testo(c.nome, 3, 80);
    const bisogno = testo(c.bisogno);
    return nome && bisogno ? { nome, bisogno, perche: testo(c.perche) } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 4);
  const numeriChiave = lista(r.numeri_chiave).map((x) => {
    const n = ogg(x);
    const voce = testo(n.voce, 3, 120);
    const valore = typeof n.valore === 'string' ? corto(n.valore) : '';
    const fonte = fonteBuona(n.fonte);
    if (!voce || !fonte || !valore || valore.length > 40 || NUMERO_VIETATO.test(`${voce} ${valore}`) || !fraseMostrabile(valore, 1, 40) || haUnNomeDiPersona(valore)) return null;
    return { voce, valore, fonte };
  }).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 4);
  return { swot, concorrenti, clientiTipo, numeriChiave };
}

export type EsitoAnalisi = { ok: true; analisi: AnalisiAvvioOrdine } | { ok: false; motivo: string };

/**
 * La risposta dell'AD diventa l'analisi dell'ordine solo se ha tutte e sole le parti della fascia e ogni frase e
 * fonte rispetta le regole legali. Altrimenti si scarta intera, col motivo.
 */
export function analisiDallaRisposta(grezza: unknown, fascia: Abbonamento, nomeLocale: string): EsitoAnalisi {
  const letta = RispostaAnalisi.safeParse(grezza);
  if (!letta.success) return { ok: false, motivo: `l’analisi dell’AD non ha la forma giusta (${letta.error.issues[0]?.path.join('.') || 'risposta'})` };
  const r = letta.data;
  const attese = partiDaScrivere(fascia);
  const arrivate = r.parti.map((p) => p.parte);
  if (new Set(arrivate).size !== arrivate.length) return { ok: false, motivo: 'l’analisi dell’AD ripete una parte' };
  const fuori = arrivate.filter((p) => !attese.includes(p));
  if (fuori.length) return { ok: false, motivo: `l’analisi dell’AD ha parti che il ${FASCE[fascia].nome} non comprende: ${fuori.map((p) => TITOLI_PARTI[p]).join(', ')}` };
  const mancano = attese.filter((p) => !arrivate.includes(p));
  if (mancano.length) return { ok: false, motivo: `all’analisi dell’AD mancano parti del ${FASCE[fascia].nome}: ${mancano.map((p) => TITOLI_PARTI[p]).join(', ')}` };

  const nome = nomeLocale.trim().toLowerCase();
  const senzaNome = (t: string) => (nome.length >= 2 ? t.split(new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(' il locale ') : t);
  const tutte = [...r.sintesi, ...r.parti.flatMap((p) => p.frasi), ...r.prime_mosse.flatMap((m) => [m.cosa, m.perche]), ...r.da_confermare];
  if (tutte.some((t) => !fraseMostrabile(senzaNome(t), 1, 10_000) || haUnNomeDiPersona(senzaNome(t)))) {
    return { ok: false, motivo: 'l’analisi dell’AD ha un prezzo, un contatto, un indirizzo web, un nome di persona o un voto di Google' };
  }
  if (r.parti.some((p) => p.fonti.some(fonteDiGoogle))) return { ok: false, motivo: 'l’analisi dell’AD cita una pagina di Google o TripAdvisor come fonte' };

  const ordine = new Map(PARTI_RAPPORTO.map((p, i) => [p, i]));
  return {
    ok: true,
    analisi: {
      origine: 'ad',
      fascia,
      quando: 'avvio',
      ritmo: ANALISI_PER_FASCIA[fascia].ritmo,
      sintesi: r.sintesi,
      parti: [...r.parti].sort((a, b) => (ordine.get(a.parte) ?? 0) - (ordine.get(b.parte) ?? 0)).map((p) => ({ parte: p.parte, titolo: TITOLI_PARTI[p.parte], frasi: p.frasi, fonti: p.fonti })),
      primeMosse: r.prime_mosse.map((m) => ({ cosa: m.cosa, perche: m.perche, quando: m.quando && fraseMostrabile(m.quando, 1, 40) && !haUnNomeDiPersona(m.quando) && !VOTO_LARGO.test(m.quando) ? m.quando : null })),
      daConfermare: r.da_confermare,
      ...pezziDelloStandard(r, fascia, (t) => !!fraseMostrabile(senzaNome(t), 1, 10_000) && !haUnNomeDiPersona(senzaNome(t))),
    },
  };
}

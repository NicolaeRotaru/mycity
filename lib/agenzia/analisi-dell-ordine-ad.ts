import { z } from 'zod';
import { FASCE } from '@/lib/agenti/fasce';
import type { Abbonamento } from './preventivo';
import { ANALISI_PER_FASCIA, PARTI_RAPPORTO, TITOLI_PARTI, fonteDiGoogle, fraseMostrabile, partiDellaFascia, type ParteRapporto } from './rapporto';
import { TETTI_FLUSSO_14, type dallaSchedaDellAgente } from './piano-completo-ad';
import { haUnNomeDiPersona } from './nomi-di-persona';
import { BISOGNI_SITO, NELL_ANALISI, TITOLI_BISOGNI, type BisogniDelSito, type BisognoSito } from './bisogni-del-sito';

/**
 * L'ANALISI DEL BUSINESS ALL'AVVIO, CHIESTA ALL'AD — 28/11/2026.
 *
 * Nicola, 28/11 verso le 00:55: all'accettazione nasce in automatico, in base all'abbonamento, anche «l'analisi di
 * business». Qui c'è il rapporto «all'avvio», uguale per tutte le fasce come ritmo (una volta), con le sole parti che
 * la fascia comprende (ANALISI_PER_FASCIA del rapporto dell'imprenditore). Il ritmo mensile del Business e quello
 * settimanale del Premium sono il secondo passo e non stanno qui.
 *
 * 28/11/2026, «anche l'analisi» — La fascia dice quanto è ampia (le parti), i BISOGNI scelti dall'agente dicono dove
 * guardare più a fondo (`NELL_ANALISI` in lib/agenzia/bisogni-del-sito.ts): un approfondimento per ogni bisogno.
 *
 * Strada: il flusso n8n 14 così com'è, la routine «90 · Chiedi all'AD», nessuna API a pagamento.
 *
 * LE REGOLE LEGALI di lib/agenzia/rapporto.ts (parere del 26/11 sui termini di Google Maps): voto, numero di
 * recensioni, orari, testi delle recensioni, nome e indirizzo letti su Google NON si salvano e non si scrivono.
 * Ogni frase passa da `fraseMostrabile` (niente prezzi, contatti, indirizzi web, nomi di persona, voti di Google);
 * ogni fonte è https e mai una pagina di Google o TripAdvisor. Una risposta che sbaglia si scarta intera.
 */

export const COMPITO_ANALISI = `Sei l'AD digitale di MyCity. SDG Agenzia (il partner di MyCity per siti, social, foto e video) ha un cliente nuovo: il titolare ha appena confermato l'abbonamento. Scrivi il RAPPORTO DEL BUSINESS ALL'AVVIO: dove si trova oggi il locale e cosa fare nei primi 30 giorni. Il titolare lo legge come bozza e lo rivede con SDG alla prima visita.

COSA HAI, in «dati»: il locale (nome, tipo, città, indirizzo pubblico), l'abbonamento con le PARTI del rapporto che comprende (e come), i BISOGNI scelti dall'agente col titolare (e dove guardare per ognuno), la nota dell'agente se c'è, e quello che hai già scritto nella scheda per il venditore. Usali: non rifare la scheda.

I BISOGNI DICONO DOVE GUARDARE PIÙ A FONDO: in «approfondimenti» una voce per OGNI bisogno in «dati.bisogni», con la sua chiave, da 1 a 4 frasi su quello che dice «dove_guardare», e le fonti. Le stesse regole di tutto il resto. La nota dell'agente è un'indicazione per te, non va copiata.

LE PARTI SONO UN CONTRATTO: una voce in «parti» per OGNI parte comprese in «dati.abbonamento.parti», con la sua chiave, e nessuna parte esclusa. Ogni parte ha da 1 a 5 frasi e le sue fonti. Se di una parte non sai niente di vero, una sola frase: «Lo leggiamo insieme alla prima visita.»

SOLO DATI PUBBLICI E VERI: puoi fare al massimo 4 ricerche (sito del locale, i suoi social pubblici, OpenStreetMap per i concorrenti vicini, il sito del comune per eventi e bandi). Meglio vuoto che inventato.

LE REGOLE LEGALI, che non si rompono mai:
- MAI voti, stelle, numero di recensioni, orari, testi di recensioni letti su Google Maps o TripAdvisor, e mai una loro pagina fra le fonti. La reputazione solo per temi («il servizio», «i dolci»), senza numeri.
- MAI nomi di persone (titolare, dipendenti, clienti, chi recensisce), mai «@profili» di altri.
- MAI prezzi, telefoni, email, indirizzi web dentro le frasi: gli indirizzi stanno solo in «fonti».
- Mai superlativi che non si possono provare. Niente gioco né tabacco.

COME SCRIVERE: italiano semplice, frasi di al massimo 25 parole, da 10 a 300 caratteri. «sintesi»: 2-4 frasi. «prime_mosse»: da 3 a 5 cose concrete per i primi 30 giorni, con il perché. «da_confermare»: al massimo 6 cose da chiedere al titolare.

In «risultato» metti l'oggetto che rispetta lo schema.`;

const s = { type: 'string' } as const;

export const SCHEMA_ANALISI = {
  type: 'object',
  required: ['sintesi', 'parti', 'approfondimenti', 'prime_mosse', 'da_confermare'],
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
    approfondimenti: {
      type: 'array', maxItems: BISOGNI_SITO.length,
      items: { type: 'object', required: ['bisogno', 'frasi', 'fonti'], properties: { bisogno: { enum: [...BISOGNI_SITO] }, frasi: { type: 'array', minItems: 1, maxItems: 4, items: s }, fonti: { type: 'array', maxItems: 5, items: s } } },
    },
    prime_mosse: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'object', required: ['cosa', 'perche'], properties: { cosa: s, perche: s } } },
    da_confermare: { type: 'array', maxItems: 6, items: s },
  },
} as const;

/** Le parti che la fascia comprende, con «come» quando c'è, per dirle all'AD. */
export const partiDaScrivere = (fascia: Abbonamento): ParteRapporto[] => partiDellaFascia(fascia).incluse.map((r) => r.parte);

/** I dati per l'AD: mai l'email del titolare o dell'agente, mai l'ora della visita. */
export function datiPerLAnalisi(input: { nome: string; tipo: string; citta: string; indirizzo: string | null; fascia: Abbonamento; scheda: ReturnType<typeof dallaSchedaDellAgente>; bisogni?: BisogniDelSito }) {
  const f = FASCE[input.fascia];
  const bisogni = input.bisogni?.bisogni.length ? input.bisogni.bisogni : (['farsi_trovare'] as BisognoSito[]);
  const dati = {
    bisogni: bisogni.map((b) => ({ bisogno: b, titolo: TITOLI_BISOGNI[b], dove_guardare: NELL_ANALISI[b] })),
    nota_dell_agente: input.bisogni?.nota ?? null,
    locale: { nome: input.nome.slice(0, 120), tipo: input.tipo.slice(0, 120), citta: input.citta.slice(0, 60), indirizzo: input.indirizzo ? input.indirizzo.slice(0, 200) : null },
    abbonamento: {
      fascia: input.fascia, nome: f.nome, analisi: f.inPratica.analisi,
      quando: 'all’avvio: questo è il primo rapporto',
      parti: partiDellaFascia(input.fascia).incluse.map((r) => ({ parte: r.parte, titolo: r.titolo, come: r.come })),
    },
    dalla_scheda_del_venditore: input.scheda,
  };
  const misura = (x: unknown) => JSON.stringify({ compito: COMPITO_ANALISI, dati: x, schema: SCHEMA_ANALISI }).length;
  return misura(dati) <= TETTI_FLUSSO_14.richiesta ? dati : { ...dati, dalla_scheda_del_venditore: null };
}

// ———————————————————————————————— la risposta dell'AD, controllata

export type ParteDellAnalisi = { parte: ParteRapporto; titolo: string; frasi: string[]; fonti: string[] };
/** L'analisi all'avvio come si salva nell'ordine (colonna `analisi` della 999h). */
export type ApprofondimentoDellAnalisi = { bisogno: BisognoSito; titolo: string; frasi: string[]; fonti: string[] };
export type AnalisiAvvioOrdine = {
  origine: 'ad';
  fascia: Abbonamento;
  quando: 'avvio';
  ritmo: string;
  sintesi: string[];
  parti: ParteDellAnalisi[];
  /** Un approfondimento per ogni bisogno scelto dall'agente (28/11). */
  approfondimenti?: ApprofondimentoDellAnalisi[];
  primeMosse: { cosa: string; perche: string }[];
  daConfermare: string[];
};

const corto = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const frase = z.string().transform(corto).pipe(z.string().min(10).max(300));
const fonte = z.string().max(500).regex(/^https:\/\/[^\s"'<>]+$/);

const RispostaAnalisi = z.object({
  sintesi: z.array(frase).min(1).max(4),
  parti: z.array(z.object({ parte: z.enum(PARTI_RAPPORTO), frasi: z.array(frase).min(1).max(5), fonti: z.array(fonte).max(5) })).min(1).max(PARTI_RAPPORTO.length),
  approfondimenti: z.array(z.object({ bisogno: z.enum(BISOGNI_SITO), frasi: z.array(frase).min(1).max(4), fonti: z.array(fonte).max(5) })).max(BISOGNI_SITO.length).default([]),
  prime_mosse: z.array(z.object({ cosa: frase, perche: frase })).min(3).max(5),
  da_confermare: z.array(frase).max(6),
});

export type EsitoAnalisi = { ok: true; analisi: AnalisiAvvioOrdine } | { ok: false; motivo: string };

/**
 * La risposta dell'AD diventa l'analisi dell'ordine solo se ha tutte e sole le parti della fascia e ogni frase e
 * fonte rispetta le regole legali. Altrimenti si scarta intera, col motivo.
 */
export function analisiDallaRisposta(grezza: unknown, fascia: Abbonamento, nomeLocale: string, bisogniScelti: readonly BisognoSito[] = []): EsitoAnalisi {
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

  const approfonditi = new Set(r.approfondimenti.map((a) => a.bisogno));
  const senza = bisogniScelti.filter((b) => !approfonditi.has(b));
  if (senza.length) return { ok: false, motivo: `l’analisi dell’AD non approfondisce: ${senza.map((b) => TITOLI_BISOGNI[b]).join(', ')}` };

  const nome = nomeLocale.trim().toLowerCase();
  const senzaNome = (t: string) => (nome.length >= 2 ? t.split(new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(' il locale ') : t);
  const tutte = [...r.sintesi, ...r.parti.flatMap((p) => p.frasi), ...r.approfondimenti.flatMap((a) => a.frasi), ...r.prime_mosse.flatMap((m) => [m.cosa, m.perche]), ...r.da_confermare];
  if (tutte.some((t) => !fraseMostrabile(senzaNome(t), 1, 10_000) || haUnNomeDiPersona(senzaNome(t)))) {
    return { ok: false, motivo: 'l’analisi dell’AD ha un prezzo, un contatto, un indirizzo web, un nome di persona o un voto di Google' };
  }
  if ([...r.parti, ...r.approfondimenti].some((p) => p.fonti.some(fonteDiGoogle))) return { ok: false, motivo: 'l’analisi dell’AD cita una pagina di Google o TripAdvisor come fonte' };

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
      approfondimenti: r.approfondimenti.filter((a) => bisogniScelti.length === 0 || bisogniScelti.includes(a.bisogno)).map((a) => ({ bisogno: a.bisogno, titolo: TITOLI_BISOGNI[a.bisogno], frasi: a.frasi, fonti: a.fonti })),
      primeMosse: r.prime_mosse,
      daConfermare: r.da_confermare,
    },
  };
}

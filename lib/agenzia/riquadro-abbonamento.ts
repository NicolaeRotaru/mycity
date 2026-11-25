import { SERVIZI_AGENZIA, type Preventivo, type ServizioAgenzia } from './preventivo';
import { hrefServizio } from './indirizzi-servizi';

/**
 * IL RIQUADRO «ABBONAMENTO» NELLA DASHBOARD DEL NEGOZIO — 24/11/2026.
 *
 * Nicola: «la sezione abbonamento deve essere nella home page, nel dashboard del venditore, in cui
 * poi dentro ci sono tutti i bottoni che ti mandano ai servizi». Prende il posto del riquadro del
 * preventivo e dell'avviso della modalità demo. Cambia secondo lo stato:
 *  · `scegli`  — nessun abbonamento: primo blocco della pagina, le tre fasce in corto, «Scegli
 *    l'abbonamento» e i tre servizi. Se il negozio è in demo lo dice: «La tua vetrina non è ancora
 *    visibile sul marketplace». Se è già in vetrina senza abbonamento (i negozi approvati prima della
 *    modalità demo, migrazione 709) non lo dice, perché sarebbe falso;
 *  · `attivo`  — abbonamento pagato: un riquadro più piccolo, dopo i numeri del giorno;
 *  · `in_ritardo` — pagamento non riuscito (past_due): primo blocco, avviso giallo.
 *
 * Lo stato si legge dall'abbonamento dei servizi (`abbonamenti_servizi`, nel calcolo del server
 * /api/seller/preventivo) e da `negozio_in_vetrina` (migrazione 709). Qui solo decisioni, senza rete.
 */

export type StatoRiquadro =
  | { tipo: 'scegli'; vetrina: 'nascosta' | 'visibile' | 'sconosciuta' }
  | { tipo: 'attivo'; fascia: NonNullable<Preventivo['attivo']>['fascia'] }
  | { tipo: 'in_ritardo'; fascia: NonNullable<Preventivo['attivo']>['fascia'] };

export function statoRiquadro(attivo: Preventivo['attivo'], inVetrina: boolean | null | undefined): StatoRiquadro {
  if (attivo?.stato === 'active') return { tipo: 'attivo', fascia: attivo.fascia };
  if (attivo?.stato === 'past_due') return { tipo: 'in_ritardo', fascia: attivo.fascia };
  return { tipo: 'scegli', vetrina: inVetrina === false ? 'nascosta' : inVetrina === true ? 'visibile' : 'sconosciuta' };
}

/** Il riquadro va in cima alla pagina, prima dei numeri, quando c'è qualcosa da fare. */
export const inCimaAllaPagina = (s: StatoRiquadro) => s.tipo !== 'attivo';

export const TESTI_RIQUADRO = {
  nascosta: 'La tua vetrina non è ancora visibile sul marketplace',
  nascostaSotto: 'Scegli un abbonamento: appena è attivo, la tua vetrina va online e i servizi li facciamo noi.',
  visibile: 'Scegli il tuo abbonamento ai servizi',
  visibileSotto: 'Foto e video, sito web, gestione dei social con Google Maps e analisi del business: li facciamo noi, tu resti al bancone.',
  pulsante: 'Scegli l’abbonamento',
  inRitardoSotto: 'Il pagamento di questo mese non è riuscito: scrivici dall’Aiuto e lo sistemiamo insieme.',
} as const;

export type PulsanteServizio = { id: ServizioAgenzia; href: string; perche: string };

/**
 * Le frasi per un servizio che dai dati risulta già a posto: niente «perché» inventato, si dice
 * solo quello che si sa.
 */
const GIA_A_POSTO: Record<ServizioAgenzia, string> = {
  foto_video: 'La tua vetrina ha già foto e video.',
  sito_web: 'Hai già un sito: lo possiamo rifare o tenere aggiornato.',
  social: 'Post e scheda Google: li prepariamo noi.',
  analisi: 'Ti diciamo cosa funziona e cosa migliorare.',
};

/** I pulsanti verso i servizi (quattro dal 24/11/2026, con l'analisi del business), ognuno col primo «perché» vero letto dalla vetrina. */
export function pulsantiServizi(
  righe: Preventivo['righe'] | null | undefined,
  /** Dove porta ogni servizio: la pagina del negozio, o quella del pannello demo del link col codice (25/11). */
  hrefDi: (id: ServizioAgenzia) => string = hrefServizio,
): PulsanteServizio[] {
  return SERVIZI_AGENZIA.map((id) => {
    const riga = righe?.find((r) => r.id === id);
    return { id, href: hrefDi(id), perche: riga?.perche[0] ?? GIA_A_POSTO[id] };
  });
}

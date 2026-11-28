import { z } from 'zod';
import { SERVIZI_AGENZIA, type ServizioAgenzia } from './preventivo';

/**
 * QUALI SERVIZI GLI SERVONO — 28/11/2026.
 *
 * Nicola, 28/11 verso le 01:10: il lavoro nasce «in base all'abbonamento ma anche al servizio di cui ha bisogno, che
 * lo selezionerà il venditore nel momento in cui seleziona l'abbonamento, prima di mandare il link al cliente». Alle
 * 01:25 ha detto quali sono le voci: «Foto e video, Gestione social e google, Gestione sitoweb, Analisi di mercato»,
 * cioè i quattro servizi che ci sono già (SERVIZI_AGENZIA). Quindi:
 *  · l'agente, nel riquadro «Che abbonamento ha scelto?» (components/agenti/AggiungiAttivita.tsx), sceglie anche
 *    quali servizi gli servono: più di uno, almeno uno; più una nota libera facoltativa di 200 caratteri;
 *  · all'accettazione nasce il lavoro dell'AD SOLO per i servizi scelti, nella misura della fascia
 *    (`LAVORO_DEL_SERVIZIO`): «Gestione sito web» → la bozza del sito, «Gestione social e Google» → il piano
 *    editoriale, «Analisi di mercato» → il rapporto. «Foto e video» non ha un lavoro dell'AD: la visita la fa la
 *    squadra di persona, e il servizio va nell'ordine e nell'avviso. Il canone non cambia.
 * La nota è un'indicazione per l'AD e per SDG, mai un testo da pubblicare: niente contatti dentro.
 * Questo file si usa anche nel browser (la pagina dell'agente): niente import dal server.
 */

export { SERVIZI_AGENZIA };
export type { ServizioAgenzia };

// 28/11/2026 01:25 — Nicola: «le voci sono: Foto e video, Gestione social e google, Gestione sitoweb, Analisi di
// mercato». Gli stessi nomi nel menu (components/seller/servizi-nel-menu.ts) e nella scelta dell'agente. I titoli interi del
// listino (LISTINO in lib/agenzia/preventivo.ts) restano: sono anche nelle descrizioni dei prodotti di SDG nel database.
export const ETICHETTE_SERVIZI: Record<ServizioAgenzia, string> = {
  foto_video: 'Foto e video',
  sito_web: 'Gestione sito web',
  social: 'Gestione social e Google',
  // 24/11/2026 — Nicola: «deve esserci dentro una voce dei servizi», prima di «Abbonamento».
  analisi: 'Analisi di mercato',
};

/** Il lavoro dell'AD che nasce per ogni servizio scelto; `null` = nessun lavoro dell'AD (lo fa la squadra). */
export const LAVORO_DEL_SERVIZIO: Record<ServizioAgenzia, 'sito' | 'piano' | 'analisi' | null> = {
  foto_video: null,
  sito_web: 'sito',
  social: 'piano',
  analisi: 'analisi',
};

/** Cosa vuol dire, detto all'agente sotto ogni voce. */
export const SPIEGAZIONE_SERVIZI: Record<ServizioAgenzia, string> = {
  foto_video: 'la visita della squadra per foto e video',
  sito_web: 'la bozza del sito, con le pagine del suo abbonamento',
  social: 'il piano dei post del primo mese e la scheda Google',
  analisi: 'il rapporto sulla sua attività e sulla sua zona',
};

/** La stessa cosa detta al titolare, nella pagina del link. */
export const SPIEGAZIONE_AL_TITOLARE: Record<ServizioAgenzia, string> = {
  foto_video: 'la squadra passa da te per foto e video',
  sito_web: 'la bozza del tuo sito, con le pagine del tuo abbonamento',
  social: 'il piano dei post del primo mese e la tua scheda Google',
  analisi: 'il rapporto sulla tua attività e sulla tua zona',
};

export const NOTA_MASSIMA = 200;

/** Una nota con un contatto (email, telefono, indirizzo web) non si salva: sono dati di persone, non indicazioni. */
export function notaConContatti(nota: string): boolean {
  return /@[a-z0-9-]+\.[a-z]{2,}/i.test(nota) || /https?:\/\/|www\./i.test(nota) || (nota.match(/[\d+][\d .\/-]*\d/g) ?? []).some((x) => x.replace(/\D/g, '').length >= 8);
}

// eslint-disable-next-line no-control-regex
const pulisciNota = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** Quello che arriva dal browser dell'agente: almeno un servizio, nessuno fuori elenco, la nota corta e senza contatti. */
export const ServiziInArrivo = z.object({
  servizi: z.array(z.enum(SERVIZI_AGENZIA, { message: 'Un servizio non è fra quelli previsti.' }), { message: 'Scegli di quali servizi ha bisogno.' })
    .min(1, 'Scegli almeno un servizio di cui ha bisogno.')
    .max(SERVIZI_AGENZIA.length)
    .transform((b) => SERVIZI_AGENZIA.filter((x) => b.includes(x))),
  nota: z.string().transform(pulisciNota)
    .pipe(z.string().max(NOTA_MASSIMA, `La nota è troppo lunga: al massimo ${NOTA_MASSIMA} caratteri.`).refine((t) => !notaConContatti(t), 'Nella nota niente email, telefoni o indirizzi web: sono indicazioni, non dati del titolare.'))
    .optional()
    .transform((t) => (t ? t : null)),
});
export type ServiziScelti = { servizi: ServizioAgenzia[]; nota: string | null };

/**
 * I servizi letti dal database o dall'ordine: quelli fuori elenco si scartano, la nota si ripulisce. `servizi` è
 * `null` quando non si sa (preventivo nato prima della 999h, o senza la scelta): allora valgono tutti e quattro,
 * come prima di questa scelta.
 */
export function leggiServiziScelti(servizi: unknown, nota: unknown): { servizi: ServizioAgenzia[] | null; nota: string | null } {
  const s = Array.isArray(servizi) ? SERVIZI_AGENZIA.filter((x) => servizi.includes(x)) : [];
  const n = typeof nota === 'string' ? pulisciNota(nota).slice(0, NOTA_MASSIMA) : '';
  return { servizi: s.length ? s : null, nota: n && !notaConContatti(n) ? n : null };
}

/** Vero se il servizio è compreso: scelto dall'agente, o tutti quando la scelta non c'è. */
export const servizioScelto = (servizi: readonly ServizioAgenzia[] | null | undefined, id: ServizioAgenzia): boolean => !servizi || servizi.length === 0 || servizi.includes(id);

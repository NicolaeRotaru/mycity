import { z } from 'zod';

/**
 * DI COSA HA BISOGNO IL SITO — 28/11/2026.
 *
 * Nicola, 28/11 verso le 01:10: il sito nasce «in base all'abbonamento ma anche al servizio di cui ha bisogno, che lo
 * selezionerà il venditore nel momento in cui seleziona l'abbonamento, prima di mandare il link al cliente». E subito
 * dopo: «anche l'analisi». Quindi:
 *  · l'agente, nel riquadro «Che abbonamento ha scelto?» (components/agenti/AggiungiAttivita.tsx), sceglie anche uno
 *    o più bisogni da questo elenco chiuso, più una nota libera facoltativa;
 *  · la fascia dice QUANTO (le pagine del sito, le parti dell'analisi); i bisogni dicono COSA (le sezioni e i
 *    pulsanti del sito, dove l'analisi guarda più a fondo).
 * La nota dell'agente è un'indicazione per l'AD, mai un testo da pubblicare: niente contatti dentro.
 * Questo file si usa anche nel browser (la pagina dell'agente): niente import dal server.
 */

export const BISOGNI_SITO = ['farsi_trovare', 'menu_listino', 'prenotazioni', 'vendere_online', 'eventi', 'portfolio'] as const;
export type BisognoSito = (typeof BISOGNI_SITO)[number];

export const TITOLI_BISOGNI: Record<BisognoSito, string> = {
  farsi_trovare: 'Farsi trovare',
  menu_listino: 'Menu o listino',
  prenotazioni: 'Prenotazioni e appuntamenti',
  vendere_online: 'Vendere i prodotti online',
  eventi: 'Eventi e serate',
  portfolio: 'Lavori fatti e portfolio',
};

/** Cosa vuol dire, detto all'agente sotto ogni voce. */
export const SPIEGAZIONE_BISOGNI: Record<BisognoSito, string> = {
  farsi_trovare: 'chi siamo, dove siamo, orari, contatti',
  menu_listino: 'i prezzi li scrive il titolare, mai noi',
  prenotazioni: 'tavolo, taglio, visita: pulsante per chiamare, WhatsApp o la chat del sito',
  vendere_online: 'il collegamento alla sua vetrina MyCity',
  eventi: 'serate, feste, appuntamenti del locale',
  portfolio: 'per artigiani e fotografi: i lavori fatti',
};

/** Cosa deve avere il sito per ogni bisogno: lo legge l'AD nel compito. */
export const NEL_SITO: Record<BisognoSito, string> = {
  farsi_trovare: 'una sezione con chi siamo, dove siamo, orari e contatti (orari e contatti «da confermare col titolare»)',
  menu_listino: 'una sezione o pagina del menu o listino, con le voci se le hai, SENZA prezzi: «prezzi da completare dal titolare»',
  prenotazioni: 'una sezione per prenotare e un pulsante «chiama», «whatsapp» o «chat» (il numero lo mette SDG)',
  vendere_online: 'una sezione sui prodotti e un pulsante «vetrina» verso la vetrina MyCity (il collegamento lo mette SDG)',
  eventi: 'una sezione eventi e serate, senza date inventate: «date da confermare col titolare»',
  portfolio: 'una sezione coi lavori fatti, con le foto da fare alla visita',
};

/** Dove l'analisi guarda più a fondo, per ogni bisogno (scelte dell'AD del 28/11, da confermare con Nicola). */
export const NELL_ANALISI: Record<BisognoSito, string> = {
  farsi_trovare: 'come appare oggi online: sito e social pubblici; la scheda Google solo col riquadro ufficiale, mai voti o recensioni',
  menu_listino: 'chi tra i concorrenti vicini ha il menu o listino online e dove (senza i loro prezzi)',
  prenotazioni: 'come prenotano i concorrenti vicini: telefono, WhatsApp, sito, app',
  vendere_online: 'chi vende già online nella zona e su quali canali',
  eventi: 'il calendario della città e gli eventi pubblici dei concorrenti',
  portfolio: 'dove mostrano i lavori i concorrenti: Instagram, sito',
};

/** I pulsanti che il sito può avere; quelli richiesti da un bisogno devono esserci. */
export const AZIONI_PULSANTE = ['chiama', 'whatsapp', 'chat', 'vetrina', 'prenota'] as const;
export type AzionePulsante = (typeof AZIONI_PULSANTE)[number];
export const PULSANTI_DEL_BISOGNO: Partial<Record<BisognoSito, readonly AzionePulsante[]>> = {
  prenotazioni: ['chiama', 'whatsapp', 'chat', 'prenota'],
  vendere_online: ['vetrina'],
};

export const NOTA_MASSIMA = 200;

/** Una nota con un contatto (email, telefono, indirizzo web) non si salva: sono dati di persone, non indicazioni. */
export function notaConContatti(nota: string): boolean {
  return /@[a-z0-9-]+\.[a-z]{2,}/i.test(nota) || /https?:\/\/|www\./i.test(nota) || (nota.match(/[\d+][\d .\/-]*\d/g) ?? []).some((x) => x.replace(/\D/g, '').length >= 8);
}

// eslint-disable-next-line no-control-regex
const pulisciNota = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** Quello che arriva dal browser dell'agente: almeno un bisogno, nessuno fuori elenco, la nota corta e senza contatti. */
export const BisogniInArrivo = z.object({
  bisogni: z.array(z.enum(BISOGNI_SITO, { message: 'Un bisogno del sito non è fra quelli previsti.' }), { message: 'Scegli di cosa ha bisogno il suo sito.' })
    .min(1, 'Scegli almeno una cosa di cui ha bisogno il suo sito.')
    .max(BISOGNI_SITO.length)
    .transform((b) => BISOGNI_SITO.filter((x) => b.includes(x))),
  nota: z.string().transform(pulisciNota)
    .pipe(z.string().max(NOTA_MASSIMA, `La nota è troppo lunga: al massimo ${NOTA_MASSIMA} caratteri.`).refine((t) => !notaConContatti(t), 'Nella nota niente email, telefoni o indirizzi web: sono indicazioni per il sito, non dati del titolare.'))
    .optional()
    .transform((t) => (t ? t : null)),
});
export type BisogniDelSito = { bisogni: BisognoSito[]; nota: string | null };

/** I bisogni letti dal database o dall'ordine: quelli fuori elenco si scartano, la nota si ripulisce. */
export function leggiBisogni(bisogni: unknown, nota: unknown): BisogniDelSito {
  const b = Array.isArray(bisogni) ? BISOGNI_SITO.filter((x) => bisogni.includes(x)) : [];
  const n = typeof nota === 'string' ? pulisciNota(nota).slice(0, NOTA_MASSIMA) : '';
  return { bisogni: b, nota: n && !notaConContatti(n) ? n : null };
}

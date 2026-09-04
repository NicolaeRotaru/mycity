/**
 * PER CONSEGNARE SERVONO DICIOTTO ANNI COMPIUTI — E QUALCUNO DEVE CONTARLI.
 *
 * 3/9/2026 — UN QUINDICENNE POTEVA ISCRIVERSI COME FATTORINO.
 *
 * Il modulo del fattorino chiede la data di nascita e la salva nel profilo. Poi
 * nessuno la guardava: né il modulo, né una regola sul database, né la
 * schermata con cui lo staff approva — che quella data non la mostra nemmeno.
 * Il risultato provato sul database ricostruito: fattorino di 15 anni, stato
 * «approvato». Le nostre condizioni, al punto 3, dicono 18 anni.
 *
 * Non è una formalità: sotto i 16 anni è lavoro minorile e basta, fra i 16 e i
 * 18 ci sono vincoli precisi, la polizza RC può non coprire, e un incidente in
 * strada con un ragazzino finisce sul giornale di Piacenza col nostro nome
 * accanto. Finora l'unica barriera era l'occhio di chi apre la foto del
 * documento.
 *
 * ⚠️ QUESTA È LA PRIMA DELLE TRE PORTE, NON L'ULTIMA. Qui si chiude quella del
 * modulo. Restano da chiudere il vincolo sul database (`legal_birth_date <=
 * oggi - 18 anni`, l'SQL è nel referto) e la schermata di approvazione, che
 * l'età deve mostrarla e sotto i 18 deve rifiutare. Finché non ci sono, il
 * controllo del browser resta una porta che si può scavalcare.
 *
 * 🟢 Pura: nessuna rete, nessun orologio nascosto — il giorno di oggi si passa
 * da fuori, così una prova può eseguirla su qualunque data.
 */
import { giornoPiacenza } from '@/lib/tempo-piacenza';

/** Gli anni che servono per consegnare. Le condizioni d'uso dicono questo. */
export const ETA_MINIMA_RIDER = 18;

export type EsitoEta = {
  ok: boolean;
  /** Cosa leggere a schermo quando non va: già scritto per il fattorino. */
  messaggio: string | null;
};

type Giorno = { anno: number; mese: number; giorno: number };

/** Legge una data «2001-04-27». Torna null se non è una data vera. */
function pezzi(data: string): Giorno | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.trim());
  if (!m) return null;
  const anno = Number(m[1]);
  const mese = Number(m[2]);
  const giorno = Number(m[3]);
  const prova = new Date(Date.UTC(anno, mese - 1, giorno));
  // Il 31 febbraio non esiste: `Date` lo fa scivolare al mese dopo, e qui si vede.
  if (
    prova.getUTCFullYear() !== anno ||
    prova.getUTCMonth() !== mese - 1 ||
    prova.getUTCDate() !== giorno
  ) {
    return null;
  }
  return { anno, mese, giorno };
}

/**
 * Quanti anni ha compiuto, al giorno indicato. Il giorno del compleanno gli
 * anni sono compiuti: il diciottesimo compleanno è il primo giorno buono.
 */
export function anniCompiuti(nascita: string, giornoDiOggi: string): number | null {
  const n = pezzi(nascita);
  const o = pezzi(giornoDiOggi);
  if (!n || !o) return null;
  let anni = o.anno - n.anno;
  const compleannoNonAncoraArrivato =
    o.mese < n.mese || (o.mese === n.mese && o.giorno < n.giorno);
  if (compleannoNonAncoraArrivato) anni -= 1;
  return anni;
}

/** Il cancello del modulo: si passa solo con 18 anni compiuti. */
export function controlloEta(nascita: string, giornoDiOggi: string = giornoPiacenza()): EsitoEta {
  if (!nascita.trim()) {
    return { ok: false, messaggio: 'Scrivi la tua data di nascita: per consegnare servono 18 anni compiuti.' };
  }
  const anni = anniCompiuti(nascita, giornoDiOggi);
  if (anni === null) {
    return { ok: false, messaggio: 'La data di nascita non è scritta bene: servono giorno, mese e anno.' };
  }
  if (anni < 0) {
    return { ok: false, messaggio: 'La data di nascita è nel futuro: ricontrollala.' };
  }
  if (anni < ETA_MINIMA_RIDER) {
    return {
      ok: false,
      messaggio: `Per consegnare con MyCity servono ${ETA_MINIMA_RIDER} anni compiuti. Ti aspettiamo al tuo compleanno.`,
    };
  }
  return { ok: true, messaggio: null };
}

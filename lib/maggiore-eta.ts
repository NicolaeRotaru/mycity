/**
 * PER CONSEGNARE SERVONO DICIOTTO ANNI COMPIUTI — E QUALCUNO DEVE CONTARLI.
 *
 * 3/9/2026 — UN QUINDICENNE POTEVA ISCRIVERSI COME FATTORINO.
 *
 * Il modulo del fattorino chiede la data di nascita e la salva nel profilo. Poi
 * nessuno la guardava: né il modulo, né una regola sul database, né la
 * schermata con cui lo staff approva — che quella data non la mostra nemmeno.
 * Il risultato provato sul database ricostruito dalle migrazioni: fattorino di
 * 15 anni, stato «approvato». Le nostre condizioni, al punto 3, dicono 18.
 *
 * Non è una formalità: sotto i 16 anni è lavoro minorile e basta, fra i 16 e i
 * 18 ci sono vincoli precisi, la polizza RC può non coprire, e un incidente in
 * strada con un ragazzino finisce sul giornale di Piacenza col nostro nome
 * accanto.
 *
 * 8/9/2026 — IL CANCELLO SI È SPOSTATO DALLA PAGINA AL DATO.
 *
 * Prima questo file stava dentro `app/rider/onboarding/`: era il controllo di
 * UNA pagina. Ma le porte che portano allo stesso posto sono quattro, e tre
 * erano sul server, dove il browser non arriva:
 *
 *   ① il modulo che scrive `legal_birth_date` nel profilo   → `controlloEta`
 *   ② `/api/kyc/upload-document`, che accettava il documento
 *      d'identità PRIMA che qualcuno avesse contato gli anni → `cancelloEtaServer`
 *   ③ `/api/kyc/start-check`, che la data la leggeva solo
 *      per passarla al fornitore                            → `cancelloEtaServer`
 *   ④ l'approvazione dello staff, che l'età non la guarda    → `risultaMinorenne`
 *
 * La quinta porta è il database: il vincolo `legal_birth_date <= oggi - 18
 * anni` (migrazione 156) è l'unico che chiude anche le strade che nasceranno
 * domani. Finché quella migrazione non è firmata, le quattro qui sopra sono la
 * difesa viva.
 *
 * 🟢 Pura: nessuna rete, nessun database, nessun orologio nascosto — il giorno
 * di oggi si passa da fuori, così una prova può eseguirla su qualunque data.
 */
import { giornoPiacenza } from '@/lib/tempo-piacenza';

/** Gli anni che servono per consegnare. Le condizioni d'uso dicono questo. */
export const ETA_MINIMA_RIDER = 18;

/** Perché la data non va bene. Serve a decidere: si corregge o si rifiuta. */
export type MotivoEta =
  | 'ok'
  | 'mancante'      // non l'ha ancora scritta: si può rimediare
  | 'illeggibile'   // non è una data vera: si può rimediare
  | 'futuro'        // nata domani: si può rimediare
  | 'minorenne';    // non si rimedia oggi, si rimedia col compleanno

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

/**
 * Il verdetto sulla data, in una parola. Da qui in giù nessuno riconta gli
 * anni per conto suo: chi decide chiede a questa.
 *
 * Accetta anche `null`/`undefined` perché è quello che arriva dal database
 * quando la colonna è vuota — e una colonna vuota non è un sì.
 */
export function motivoEta(
  nascita: string | null | undefined,
  giornoDiOggi: string = giornoPiacenza(),
): MotivoEta {
  if (typeof nascita !== 'string' || !nascita.trim()) return 'mancante';
  const anni = anniCompiuti(nascita, giornoDiOggi);
  if (anni === null) return 'illeggibile';
  if (anni < 0) return 'futuro';
  if (anni < ETA_MINIMA_RIDER) return 'minorenne';
  return 'ok';
}

const FRASE: Record<Exclude<MotivoEta, 'ok'>, string> = {
  mancante:
    'Scrivi la tua data di nascita: per consegnare servono 18 anni compiuti.',
  illeggibile:
    'La data di nascita non è scritta bene: servono giorno, mese e anno.',
  futuro: 'La data di nascita è nel futuro: ricontrollala.',
  minorenne: `Per consegnare con MyCity servono ${ETA_MINIMA_RIDER} anni compiuti. Ti aspettiamo al tuo compleanno.`,
};

/** Il cancello del modulo: si passa solo con 18 anni compiuti. */
export function controlloEta(
  nascita: string | null | undefined,
  giornoDiOggi: string = giornoPiacenza(),
): EsitoEta {
  const motivo = motivoEta(nascita, giornoDiOggi);
  if (motivo === 'ok') return { ok: true, messaggio: null };
  return { ok: false, messaggio: FRASE[motivo] };
}

/**
 * La data che abbiamo in archivio dice che è minorenne.
 *
 * È diverso da `controlloEta`: qui la data VUOTA non è un rifiuto. Serve alla
 * porta dell'approvazione, dove passano anche i venditori e i clienti nati
 * prima che questo campo esistesse: se la data non c'è non è quella schermata
 * il posto per chiederla, ma se c'è ed è di un ragazzino non si approva.
 */
export function risultaMinorenne(
  nascita: string | null | undefined,
  giornoDiOggi: string = giornoPiacenza(),
): boolean {
  return motivoEta(nascita, giornoDiOggi) === 'minorenne';
}

export type DecisioneServer = {
  ok: boolean;
  motivo: MotivoEta;
  /** 200 passa · 400 «sistemala tu» · 403 «no, e non è questione di scriverla meglio». */
  stato: 200 | 400 | 403;
  messaggio: string | null;
};

/**
 * Il cancello delle rotte che accettano i dati e i documenti del fattorino.
 *
 * Qui la regola è severa al contrario di `risultaMinorenne`: **senza data non
 * si entra**. Il motivo è il caso vero raccontato nel referto — non il ragazzo
 * che aggira il controllo, ma quello che lo subisce. Se accettiamo la carta
 * d'identità prima di sapere quanti anni ha, il documento di un quindicenne è
 * già nel nostro archivio quando scopriamo che non può fare il fattorino: lo
 * conserviamo senza una base giuridica utile (il contratto che lo
 * giustificherebbe non può esistere) e nessuno lo cancellerà mai, perché quel
 * ragazzo l'account non lo chiuderà.
 *
 * Quindi: prima la data di nascita, poi i documenti. In quest'ordine.
 */
export function cancelloEtaServer(
  profilo: { legal_birth_date?: string | null } | null | undefined,
  giornoDiOggi: string = giornoPiacenza(),
): DecisioneServer {
  const motivo = motivoEta(profilo?.legal_birth_date, giornoDiOggi);
  if (motivo === 'ok') return { ok: true, motivo, stato: 200, messaggio: null };
  if (motivo === 'minorenne') {
    return { ok: false, motivo, stato: 403, messaggio: FRASE.minorenne };
  }
  return {
    ok: false,
    motivo,
    stato: 400,
    messaggio:
      'Prima salva la tua data di nascita nel passo 1: senza quella non possiamo accettare i documenti. Per consegnare servono 18 anni compiuti.',
  };
}

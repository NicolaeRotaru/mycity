import { NextResponse } from 'next/server';

/**
 * 31/10/2026 — I LAVORI A ORARIO RESTANO FERMI FINCHÉ NICOLA NON LI ACCENDE.
 *
 * Gli undici lavori di `vercel.json` (posta, notifiche, bonifici, scadenze,
 * cancellazioni degli account…) oggi su Vercel non fanno niente: manca la
 * chiave di servizio del database e rispondono «Service role non configurato».
 * Il giorno in cui la chiave arriva partirebbero tutti da soli, insieme, su
 * codice che in produzione non ha mai girato — compreso `process-deletions`,
 * che cancella account veri e non si torna indietro.
 *
 * Il fermo è ACCESO PER DIFETTO: senza la variabile `LAVORI_A_ORARIO`, o con
 * qualunque valore che non sia esattamente «accesi», la chiamata del calendario
 * di Vercel risponde 200 e non tocca niente. Il primo giro si fa a mano, un
 * lavoro alla volta, aggiungendo `?a_mano=1`; quando tutti e undici hanno girato
 * bene, Nicola mette `LAVORI_A_ORARIO=accesi` e il calendario riparte da solo.
 *
 * Il fermo NON sostituisce il segreto: `withCronAuth` controlla `CRON_SECRET`
 * PRIMA, e la chiamata a mano senza il segreto giusto resta un 401.
 *
 * Un giro fermo non scrive il battito in `cron_heartbeats`: il battito dice «il
 * giro è avvenuto», e qui non è avvenuto. Così il semaforo mostra i lavori fermi
 * per quello che sono, invece di dirli vivi mentre non fanno niente.
 */

export const VARIABILE_DEL_FERMO = 'LAVORI_A_ORARIO';
export const VALORE_CHE_ACCENDE = 'accesi';
export const PARAMETRO_A_MANO = 'a_mano';

/** L'intestazione che dice a `withCronAuth` «questo giro non è avvenuto: niente battito». */
export const INTESTAZIONE_GIRO_NON_FATTO = 'x-mycity-giro-non-fatto';

export const MOTIVO_DEL_FERMO =
  `${VARIABILE_DEL_FERMO} non è «${VALORE_CHE_ACCENDE}»: la chiamata del calendario non lavora. ` +
  `Per una chiamata a mano aggiungi ?${PARAMETRO_A_MANO}=1`;

/**
 * Vero se la chiamata porta `?<nome>=1`. Un indirizzo che non si legge vale
 * «no»: per il fermo vuol dire restare fermi, che è la parte sicura.
 */
export function parametroAcceso(req: { url: string }, nome: string): boolean {
  try {
    return new URL(req.url).searchParams.get(nome) === '1';
  } catch {
    return false;
  }
}

/**
 * La regola, senza effetti: «fermo» quando i lavori non sono accesi E la
 * chiamata non è fatta a mano. Il confronto è esatto, di proposito: «Accesi»,
 * «accesi » o «true» lasciano il fermo dove sta — sbagliare a scrivere la
 * variabile deve lasciare i lavori fermi, non farli partire.
 */
export function chiamataDelCalendarioFerma(
  req: { url: string },
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env[VARIABILE_DEL_FERMO] === VALORE_CHE_ACCENDE) return false;
  return !parametroAcceso(req, PARAMETRO_A_MANO);
}

/** Segna una risposta come «giro non avvenuto»: `withCronAuth` non scrive il battito. */
export function segnaGiroNonFatto<R extends Response>(risposta: R, perche: 'fermo' | 'solo_conta'): R {
  risposta.headers.set(INTESTAZIONE_GIRO_NON_FATTO, perche);
  return risposta;
}

/** Vero se la risposta dice che il giro non è avvenuto. */
export function giroNonFatto(risposta: Response): boolean {
  const intestazioni = (risposta as { headers?: Headers }).headers;
  return typeof intestazioni?.get === 'function' && intestazioni.get(INTESTAZIONE_GIRO_NON_FATTO) !== null;
}

/** Quello che risponde un lavoro fermo: 200, perché fermo è lo stato voluto, non un guasto. */
export function rispostaDelFermo(): NextResponse {
  return segnaGiroNonFatto(
    NextResponse.json({ ok: true, fermo: true, motivo: MOTIVO_DEL_FERMO }),
    'fermo',
  );
}

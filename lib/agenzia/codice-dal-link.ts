import crypto from 'node:crypto';
import { env } from '@/lib/env';

/**
 * IL CODICE DELL'EMAIL LO FA E LO CONTROLLA IL SITO — 27/11/2026.
 *
 * Nicola ha scelto «codice dall'email»: il titolare conferma l'abbonamento dalla pagina del link scrivendo il
 * codice che gli arriva per email, così entra solo chi possiede l'email. Il secondo collaudo della sicurezza
 * ha bocciato la prima forma: per mandare il codice si metteva l'email sull'utente del negozio, e chi aveva il
 * link poteva chiederlo con la SUA email ed entrare prima dell'accettazione, senza avviso a Nicola.
 *
 * Ora l'utente del negozio non si tocca finché il codice non torna giusto. Il codice (6 cifre, casuale)
 * lo crea il sito e non lo salva da nessuna parte: al browser va un «gettone» firmato con un segreto che
 * sta solo sul server. Il gettone lega insieme il link, l'email, la scadenza e il codice. Il browser lo
 * rimanda insieme al codice scritto dal titolare, e il server rifà la firma: torna solo con quel codice,
 * per quell'email e quel link, prima della scadenza. Senza il segreto, dal gettone il codice non si ricava.
 * Il numero di tentativi lo conta chi chiama (app/api/preventivo/[codice]/accetta), col gettone come chiave.
 */

/** Quanto vale un codice: 10 minuti. */
export const DURATA_CODICE_MS = 10 * 60_000;

function segreto(): string | null {
  const dedicato = process.env.CODICE_PREVENTIVO_SECRET;
  if (dedicato) return dedicato;
  // Ripiego: una chiave DERIVATA da quella di servizio, mai la chiave stessa (come lib/auth/segno-recupero.ts).
  let servizio: string | undefined;
  try {
    servizio = env.supabaseServiceRoleKey();
  } catch {
    return null;
  }
  if (!servizio) return null;
  return crypto.createHmac('sha256', servizio).update('mycity:codice-preventivo:v1').digest('base64url');
}

function firma(chiave: string, parti: { link: string; email: string; scade: number; nonce: string; codice: string }): string {
  return crypto
    .createHmac('sha256', chiave)
    .update(['codice-preventivo', parti.link, parti.email, String(parti.scade), parti.nonce, parti.codice].join('|'))
    .digest('base64url');
}

type Contenuto = { e: string; x: number; n: string; t: string };

/** Un codice nuovo e il suo gettone. `null` senza segreto sul server: allora non si può confermare da qui. */
export function creaCodice(input: { link: string; email: string; adesso?: number }): { codice: string; gettone: string } | null {
  const chiave = segreto();
  if (!chiave) return null;
  const codice = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const scade = (input.adesso ?? Date.now()) + DURATA_CODICE_MS;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const contenuto: Contenuto = { e: input.email, x: scade, n: nonce, t: firma(chiave, { link: input.link, email: input.email, scade, nonce, codice }) };
  return { codice, gettone: Buffer.from(JSON.stringify(contenuto)).toString('base64url') };
}

export type EsitoVerifica = 'giusto' | 'sbagliato' | 'scaduto' | 'non-valido';

/** Il codice scritto dal titolare torna con quel gettone, per quell'email e quel link, prima della scadenza? */
export function verificaCodice(input: { link: string; email: string; codice: string; gettone: string; adesso?: number }): EsitoVerifica {
  const chiave = segreto();
  if (!chiave) return 'non-valido';
  let contenuto: Contenuto;
  try {
    contenuto = JSON.parse(Buffer.from(input.gettone, 'base64url').toString('utf8')) as Contenuto;
  } catch {
    return 'non-valido';
  }
  if (!contenuto || typeof contenuto.e !== 'string' || typeof contenuto.x !== 'number' || typeof contenuto.n !== 'string' || typeof contenuto.t !== 'string') {
    return 'non-valido';
  }
  // Il gettone vale solo per l'email a cui è partito il codice.
  if (contenuto.e !== input.email) return 'non-valido';
  if ((input.adesso ?? Date.now()) > contenuto.x) return 'scaduto';
  const atteso = Buffer.from(firma(chiave, { link: input.link, email: contenuto.e, scade: contenuto.x, nonce: contenuto.n, codice: input.codice }));
  const arrivato = Buffer.from(contenuto.t);
  if (atteso.length !== arrivato.length || !crypto.timingSafeEqual(atteso, arrivato)) return 'sbagliato';
  return 'giusto';
}

/** Una chiave corta e stabile del gettone, per contare i tentativi senza scrivere il gettone intero. */
export function chiaveDelGettone(gettone: string): string {
  return crypto.createHash('sha256').update(gettone).digest('base64url').slice(0, 32);
}

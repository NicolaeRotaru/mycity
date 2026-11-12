import crypto from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Link di disiscrizione dalle email, senza dover accedere.
 *
 * Perché serve: il footer dei messaggi diceva soltanto «Gestisci preferenze» e
 * puntava a una pagina che chiede il login. Chi riceve una email di marketing
 * deve poter smettere di riceverla con un clic, senza account — è un obbligo,
 * e prima non c'era nessun link con questa proprietà.
 *
 * Il token porta indirizzo + ambito cifrati e autenticati (vedi sotto, R08-020): non è
 * indovinabile, non si legge e non richiede di tenere niente in memoria. Chi ha il link può disiscrivere solo
 * quell'indirizzo da quell'ambito, e nient'altro.
 */

export type AmbitoDisiscrizione = 'newsletter' | 'marketing';

function segreto(): string {
  const dedicato = process.env.UNSUBSCRIBE_SECRET;
  if (dedicato) return dedicato;

  // 081 — Prima qui si ripiegava sulla chiave di servizio di Supabase, e in
  // ultima istanza sulla stringa 'mycity-dev' scritta nel codice. Due guai in
  // uno: chi conosceva quella stringa poteva firmarsi da solo un link valido e
  // disiscrivere chiunque, e la chiave che scavalca ogni regola del database
  // diventava materiale crittografico presente in ogni email spedita.
  // In produzione, senza segreto dedicato, i link non si firmano: si dice e si
  // ripara. Fuori dalla produzione resta il valore fisso, cosi' i link restano
  // stabili fra un riavvio e l'altro.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'UNSUBSCRIBE_SECRET non configurata: senza segreto dedicato i link di disiscrizione non si firmano.',
    );
  }
  return 'mycity-dev';
}

/**
 * 12/11/2026 (R08-020) — IL GETTONE NON PORTA PIÙ L'EMAIL LEGGIBILE.
 *
 * Il gettone di prima era `base64url(email:ambito).firma`: firmato, quindi non
 * falsificabile, ma chiunque lo decodificava leggeva l'indirizzo. E il gettone sta
 * nell'indirizzo web (/api/unsubscribe?token=…, poi /disiscrizione?token=…), cioè
 * nei log delle richieste di Vercel e in ogni proxy che registra gli indirizzi:
 * indirizzi email fuori dalle regole di conservazione dichiarate.
 *
 * Adesso il dato viaggia CIFRATO (AES-256-GCM, con una chiave derivata dal segreto
 * dei link): `v2.<base64url di iv | cifrato | etichetta>`. L'etichetta di GCM fa da
 * firma — un gettone manomesso non si apre. La funzione del database `disiscrivi`
 * riceve sempre l'email, quindi niente migrazione.
 *
 * I gettoni vecchi restano validi: sono già nelle email spedite, e chi clicca
 * «smetti» su una email di ieri deve poter smettere.
 */
const VERSIONE_CIFRATA = 'v2';

function chiaveDiCifratura(): Buffer {
  // Una chiave diversa da quella della firma, dallo stesso segreto: le due cose non si mescolano.
  return crypto.createHmac('sha256', segreto()).update('disiscrizione:cifratura:v2').digest();
}

export function firmaDisiscrizione(email: string, ambito: AmbitoDisiscrizione): string {
  const dato = `${email.trim().toLowerCase()}:${ambito}`;
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', chiaveDiCifratura(), iv);
  const cifrato = Buffer.concat([cifra.update(dato, 'utf8'), cifra.final()]);
  const etichetta = cifra.getAuthTag();
  return `${VERSIONE_CIFRATA}.${Buffer.concat([iv, cifrato, etichetta]).toString('base64url')}`;
}

function apriCifrato(corpo: string): string | null {
  try {
    const tutto = Buffer.from(corpo, 'base64url');
    if (tutto.length < 12 + 16 + 3) return null;
    const iv = tutto.subarray(0, 12);
    const etichetta = tutto.subarray(tutto.length - 16);
    const cifrato = tutto.subarray(12, tutto.length - 16);
    const apri = crypto.createDecipheriv('aes-256-gcm', chiaveDiCifratura(), iv);
    apri.setAuthTag(etichetta);
    return Buffer.concat([apri.update(cifrato), apri.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Il formato di prima del 12/11/2026: `base64url(email:ambito).firma HMAC`. */
function apriFirmato(token: string): string | null {
  const punto = token.lastIndexOf('.');
  if (punto <= 0) return null;

  const corpo = token.slice(0, punto);
  const firma = token.slice(punto + 1);

  let dato: string;
  try {
    dato = Buffer.from(corpo, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const atteso = crypto.createHmac('sha256', segreto()).update(dato).digest('base64url');
  // Confronto a tempo costante: non far capire dove la firma inizia a divergere.
  const a = Buffer.from(firma);
  const b = Buffer.from(atteso);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return dato;
}

export function verificaDisiscrizione(
  token: string,
): { email: string; ambito: AmbitoDisiscrizione } | null {
  const dato = token.startsWith(`${VERSIONE_CIFRATA}.`)
    ? apriCifrato(token.slice(VERSIONE_CIFRATA.length + 1))
    : apriFirmato(token);
  if (!dato) return null;

  const [email, ambito] = dato.split(':');
  if (!email || (ambito !== 'newsletter' && ambito !== 'marketing')) return null;
  return { email, ambito };
}

export function linkDisiscrizione(email: string, ambito: AmbitoDisiscrizione): string {
  // Il dominio scritto a mano qui non era quello vero (la configurazione diceva
  // mycity-marketplace.com): un link di disiscrizione che porta altrove non vale.
  const base = env.appUrl();
  return `${base}/api/unsubscribe?token=${encodeURIComponent(firmaDisiscrizione(email, ambito))}`;
}

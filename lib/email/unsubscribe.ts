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
 * Il token è una firma (HMAC) su indirizzo + ambito: non è indovinabile e non
 * richiede di tenere niente in memoria. Chi ha il link può disiscrivere solo
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

export function firmaDisiscrizione(email: string, ambito: AmbitoDisiscrizione): string {
  const dato = `${email.trim().toLowerCase()}:${ambito}`;
  const firma = crypto.createHmac('sha256', segreto()).update(dato).digest('base64url');
  return `${Buffer.from(dato).toString('base64url')}.${firma}`;
}

export function verificaDisiscrizione(
  token: string,
): { email: string; ambito: AmbitoDisiscrizione } | null {
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

  const [email, ambito] = dato.split(':');
  if (!email || (ambito !== 'newsletter' && ambito !== 'marketing')) return null;
  return { email, ambito };
}

export function linkDisiscrizione(email: string, ambito: AmbitoDisiscrizione): string {
  // Il dominio scritto a mano qui non era quello vero (render.yaml dice
  // mycity-marketplace.com): un link di disiscrizione che porta altrove non vale.
  const base = env.appUrl();
  return `${base}/api/unsubscribe?token=${encodeURIComponent(firmaDisiscrizione(email, ambito))}`;
}

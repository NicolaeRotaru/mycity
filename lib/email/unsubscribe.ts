import crypto from 'node:crypto';

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
  // In produzione la variabile c'è; in sviluppo si usa un valore fisso così i
  // link restano stabili tra riavvii.
  return process.env.UNSUBSCRIBE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'mycity-dev';
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
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mycity.it';
  return `${base}/api/unsubscribe?token=${encodeURIComponent(firmaDisiscrizione(email, ambito))}`;
}

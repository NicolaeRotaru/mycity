import crypto from 'node:crypto';
import { env } from '@/lib/env';

/**
 * 1/11/2026 — IL RIENTRO COL LINK DI RECUPERO PASSATO DA /auth/confirm.
 *
 * Quando il link dell'email passa da /auth/confirm, il server apre la sessione
 * con `verifyOtp` e Supabase la segna come «otp», non come «recovery»: nel
 * browser non arriva nessun evento che dica «questa persona viene dal link».
 * La pagina della nuova password allora non saprebbe distinguerla da chi è
 * solo entrato con un link d'accesso.
 *
 * Il segno lo mette il SERVER, subito dopo un `verifyOtp` di tipo recovery
 * riuscito: un biscotto che il JavaScript della pagina non legge (httpOnly),
 * firmato con un segreto che sta solo sul server, legato a QUELLA sessione e
 * valido un'ora. Il browser non lo può scrivere da sé: per fabbricarlo
 * servirebbe il segreto.
 */
export const BISCOTTO_RECUPERO = 'mycity_recupero';
export const DURATA_RECUPERO_SECONDI = 60 * 60;

function segreto(): string | null {
  const dedicato = process.env.RECUPERO_PASSWORD_SECRET;
  if (dedicato) return dedicato;
  // Ripiego: una chiave DERIVATA da quella di servizio, mai la chiave stessa.
  // Il risultato non esce dal server (resta nella firma di un biscotto
  // httpOnly), e chi lo vede non può risalire alla chiave.
  let servizio: string | undefined;
  try {
    servizio = env.supabaseServiceRoleKey();
  } catch {
    return null;
  }
  if (!servizio) return null;
  return crypto.createHmac('sha256', servizio).update('mycity:segno-recupero-password:v1').digest('base64url');
}

/** L'identificativo della sessione scritto dal server dentro il gettone d'accesso. */
export function sessioneDelGettone(gettone: string | null | undefined): string | null {
  if (typeof gettone !== 'string') return null;
  const parti = gettone.split('.');
  if (parti.length !== 3) return null;
  try {
    const dati = JSON.parse(Buffer.from(parti[1], 'base64url').toString('utf8')) as { session_id?: unknown };
    return typeof dati.session_id === 'string' && dati.session_id ? dati.session_id : null;
  } catch {
    return null;
  }
}

function firma(dato: string, chiave: string): string {
  return crypto.createHmac('sha256', chiave).update(dato).digest('base64url');
}

/** Il valore del biscotto per questa sessione; null se manca il segreto o la sessione. */
export function firmaSegnoRecupero(sessione: string | null, adessoMs = Date.now()): string | null {
  const chiave = segreto();
  if (!chiave || !sessione) return null;
  const scade = Math.floor(adessoMs / 1000) + DURATA_RECUPERO_SECONDI;
  const dato = `${sessione}.${scade}`;
  return `${dato}.${firma(dato, chiave)}`;
}

/** Vero solo se il biscotto è firmato da noi, per QUESTA sessione, e non è scaduto. */
export function verificaSegnoRecupero(
  valore: string | null | undefined,
  sessione: string | null,
  adessoMs = Date.now(),
): boolean {
  const chiave = segreto();
  if (!chiave || !sessione || typeof valore !== 'string') return false;
  const ultimo = valore.lastIndexOf('.');
  if (ultimo <= 0) return false;
  const dato = valore.slice(0, ultimo);
  const data = valore.slice(ultimo + 1);
  const a = Buffer.from(data);
  const b = Buffer.from(firma(dato, chiave));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const punto = dato.lastIndexOf('.');
  if (punto <= 0) return false;
  if (dato.slice(0, punto) !== sessione) return false;
  const scade = Number(dato.slice(punto + 1));
  return Number.isFinite(scade) && scade * 1000 >= adessoMs;
}

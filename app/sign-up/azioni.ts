'use server';

import { headers } from 'next/headers';
import { getClientIp, rateLimitAsync } from '@/lib/rate-limit';

/**
 * 27/11/2026 (R12-012) — IL FRENO SULLE ISCRIZIONI PASSA DAL SERVER.
 *
 * La pagina di registrazione chiamava Supabase dal browser e basta: nessun
 * conto delle iscrizioni per rete. Da una stessa rete si potevano creare
 * account a raffica, e ognuno faceva partire un'email di conferma dal nostro
 * dominio verso indirizzi di terzi. Il freno c'era solo nella rotta
 * app/api/auth/signup, che nessuna pagina chiama.
 *
 * Adesso, prima di creare l'account, la pagina chiede qui il permesso: il
 * conto lo tiene il server, con lo stesso freno e la stessa chiave di quella
 * rotta (5 iscrizioni all'ora per indirizzo, `signup:<ip>`, contatore condiviso
 * su Upstash). Sotto la soglia l'iscrizione resta quella di prima, dal browser
 * col flusso PKCE: il link di conferma e il segnale «registrazione» nelle
 * statistiche non cambiano.
 *
 * Cosa non fa: non ferma chi chiama Supabase direttamente con la chiave
 * pubblica. Quello lo ferma solo Supabase (CAPTCHA e limiti in Authentication),
 * cioè l'anti-robot, che è una scelta di Nicola.
 */
const ISCRIZIONI_PER_RETE = 5;
const FINESTRA_MS = 60 * 60_000;

export type PermessoDiIscrizione =
  | { ok: true }
  | { ok: false; riprovaFraSecondi: number; messaggio: string };

export async function chiediPermessoDiIscrizione(): Promise<PermessoDiIscrizione> {
  // L'indirizzo si legge come in tutte le rotte (lib/rate-limit.ts), dalle stesse intestazioni.
  const ip = getClientIp(new Request('http://localhost/', { headers: await headers() }));
  const freno = await rateLimitAsync({ key: `signup:${ip}`, max: ISCRIZIONI_PER_RETE, windowMs: FINESTRA_MS });
  if (freno.allowed) return { ok: true };
  return {
    ok: false,
    riprovaFraSecondi: freno.retryAfterSec,
    messaggio: 'Troppe registrazioni da questa rete. Riprova più tardi.',
  };
}

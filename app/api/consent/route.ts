import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

export const runtime = 'nodejs';

/**
 * Registra la scelta sui cookie, così che ne resti una prova.
 *
 * Prima il consenso viveva soltanto nel browser di chi lo dava: localStorage
 * più un cookie con tre cifre. Se quella persona svuotava la cronologia, la
 * scelta spariva — e noi non avevamo modo di dimostrare né quando né a cosa
 * avesse detto sì. Qui la si scrive con la data, la versione del testo mostrato,
 * l'indirizzo di rete e il browser.
 */

const Body = z.object({
  analytics: z.boolean(),
  marketing: z.boolean(),
  versione: z.string().max(40).optional(),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = await rateLimitAsync({ key: `consent:${ip}`, max: 30, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let raw: unknown;
  try {
    raw = await jsonRichiesta(request, TETTO_JSON);
  } catch {
    return ApiErrors.invalidRequest('Body JSON non valido');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    // #69 — Questa rotta era muta: rifiutava e non diceva niente. Un registro
    // dei consensi vuoto sembra «nessuno ha ancora scelto», non «li stiamo
    // buttando via tutti». Ora il rifiuto si vede nei log.
    logger.warn('[consent] registrazione rifiutata: dati non validi', {
      motivo: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`).join(', '),
    });
    return ApiErrors.invalidRequest('Dati non validi');
  }

  // Se c'è una sessione la scelta si lega alla persona; altrimenti resta
  // anonima, agganciata all'identificatore del browser.
  let userId: string | null = null;
  try {
    const supa = await getServerSupabase();
    const { data } = await supa.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }

  /**
   * #77 — A chi appartiene una scelta fatta senza account.
   *
   * `mc_vid` esiste solo DOPO che qualcuno ha accettato l'analitica: chi
   * rifiutava, o chi personalizzava, finiva registrato senza nessun
   * riferimento — ne' persona ne' browser. Righe che dicono «qualcuno ha
   * rifiutato» e non si possono collegare a nessuno: inutili per dimostrare
   * alcunche', e inutili anche per rispettare la scelta.
   *
   * Se `mc_vid` non c'e', se ne crea uno apposta per il registro (`mc_cid`):
   * casuale, dura quanto il consenso, e serve solo a legare la scelta a chi
   * l'ha fatta — non a seguirlo in giro.
   */
  const cookie = request.headers.get('cookie') ?? '';
  const vid = cookie.match(/mc_vid=([^;]+)/)?.[1] ?? null;
  const cidEsistente = cookie.match(/mc_cid=([^;]+)/)?.[1] ?? null;
  const cidNuovo = !userId && !vid && !cidEsistente ? crypto.randomUUID() : null;
  const anonId = vid ?? cidEsistente ?? cidNuovo;
  const userAgent = request.headers.get('user-agent')?.slice(0, 300) ?? null;
  const versione = parsed.data.versione ?? null;

  const righe = (['analytics', 'marketing'] as const).map((categoria) => ({
    user_id: userId,
    anon_id: userId ? null : anonId,
    categoria,
    valore: parsed.data[categoria],
    versione_testo: versione,
    ip,
    user_agent: userAgent,
  }));

  const { error } = await getAdminSupabase().from('consent_log').insert(righe);
  if (error) {
    logger.error(new Error('[consent] scrittura nel registro fallita'), { message: error.message });
    return ApiErrors.internal('Registrazione non riuscita');
  }

  const risposta = NextResponse.json({ ok: true });
  if (cidNuovo) {
    // Solo per il registro dei consensi: httpOnly (il browser non lo legge) e
    // durata pari a quella del consenso stesso.
    risposta.cookies.set({
      name: 'mc_cid',
      value: cidNuovo,
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 180 * 24 * 60 * 60,
    });
  }
  return risposta;
}

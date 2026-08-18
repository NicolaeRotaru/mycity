import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { ApiErrors } from '@/lib/api/responses';

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
    raw = await request.json();
  } catch {
    return ApiErrors.invalidRequest('Body JSON non valido');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return ApiErrors.invalidRequest('Dati non validi');

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

  const anonId = request.headers.get('cookie')?.match(/mc_vid=([^;]+)/)?.[1] ?? null;
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
  if (error) return ApiErrors.internal('Registrazione non riuscita');

  return NextResponse.json({ ok: true });
}

import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';

export const runtime = 'nodejs';

/**
 * Mette a verbale l'accettazione di Termini e Informativa per chi è entrato da
 * una strada che non la chiedeva — oggi: l'accesso con Google fatto prima che
 * la spunta esistesse.
 *
 * Registra la stessa cosa che registra la registrazione con email: categoria,
 * versione del testo, indirizzo di rete e browser. Senza quella riga, il giorno
 * in cui qualcuno contesta una condizione non c'è niente da mostrare.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supa = await getServerSupabase();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return ApiErrors.unauthorized();

  try {
    const admin = getAdminSupabase();
    const { data: profilo } = await admin
      .from('profiles')
      .select('tos_accepted_at')
      .eq('id', user.id)
      .maybeSingle();

    // Già accettato: non si scrive una seconda riga per la stessa cosa.
    if (profilo?.tos_accepted_at) return NextResponse.json({ ok: true, gia: true }, { status: 200 });

    await admin.from('consent_log').insert({
      user_id: user.id,
      categoria: 'privacy_terms',
      valore: true,
      versione_testo: VERSIONE_TESTI_LEGALI.slice(0, 60),
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });
    await admin
      .from('profiles')
      .update({ tos_accepted_at: new Date().toISOString() })
      .eq('id', user.id);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    logger.error('[condizioni] accettazione non registrata', { userId: user.id, e });
    return ApiErrors.internal('Non è stato possibile registrare l accettazione');
  }
}

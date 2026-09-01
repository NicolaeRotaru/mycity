import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { getClientIp, rateLimitAsync } from '@/lib/rate-limit';
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

  // 27/8/2026 (R140) — Due letture e due scritture per chiamata, senza nessun
  // freno. Accettare le condizioni si fa una volta: venti tentativi al minuto
  // sono gia' larghi per chi ricarica la pagina.
  const freno = await rateLimitAsync({ key: `accetta-condizioni:${user.id}`, max: 20, windowMs: 60_000 });
  if (!freno.allowed) return ApiErrors.rateLimited(freno.retryAfterSec);

  try {
    const admin = getAdminSupabase();
    const { data: profilo } = await admin
      .from('profiles')
      .select('tos_accepted_at')
      .eq('id', user.id)
      .maybeSingle();

    // Già accettato: non si scrive una seconda riga per la stessa cosa.
    if (profilo?.tos_accepted_at) return NextResponse.json({ ok: true, gia: true }, { status: 200 });

    // 27/8/2026 (R024 · R062) — L'INDIRIZZO DI RETE SE LO SCRIVEVA L'UTENTE.
    // `x-forwarded-for` e' una catena, e il primo pezzo lo mette il chiamante:
    // chiunque poteva dettare l'indirizzo che finiva nel verbale. Ed e' proprio
    // il campo che deve reggere il giorno in cui un venditore contesta una
    // condizione contrattuale, o il Garante chiede conto di un consenso. Una
    // prova che non prova niente e' peggio di una prova assente, perche'
    // nessuno la va a controllare. `getClientIp` legge da destra scartando i
    // proxy fidati (e preferisce `cf-connecting-ip`), cioe' il pezzo scritto
    // dalla nostra infrastruttura: quello non si falsifica da fuori.
    const { error: errConsenso } = await admin.from('consent_log').insert({
      user_id: user.id,
      categoria: 'privacy_terms',
      valore: true,
      versione_testo: VERSIONE_TESTI_LEGALI.slice(0, 60),
      ip: getClientIp(req),
      user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });
    // 27/8/2026 (R140) — L'ESITO DELL'INSERT NON VENIVA LETTO. supabase-js non
    // lancia: restituisce `{ error }`, quindi il try/catch qui sopra non lo
    // copriva. Se il consenso non entrava e il profilo si', il registro e il
    // profilo raccontavano due cose diverse — e la divergenza si scopriva
    // esattamente il giorno in cui serviva la prova.
    if (errConsenso) {
      logger.error('[condizioni] consenso non messo a verbale, profilo non aggiornato', {
        userId: user.id, message: errConsenso.message,
      });
      return ApiErrors.internal('Non è stato possibile registrare l accettazione');
    }
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

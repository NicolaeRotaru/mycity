import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { BISCOTTO_RECUPERO, sessioneDelGettone, verificaSegnoRecupero } from '@/lib/auth/segno-recupero';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 1/11/2026 — La pagina della nuova password chiede qui se la sessione di
 * adesso è nata dal link di recupero passato da /auth/confirm. Risponde sì
 * solo se il biscotto firmato dal server c'è, è per QUESTA sessione (che
 * Supabase conferma con `getUser`) e non è scaduto.
 */
export async function GET(req: NextRequest) {
  const no = () => NextResponse.json({ recupero: false }, { headers: { 'Cache-Control': 'no-store' } });
  const valore = req.cookies.get(BISCOTTO_RECUPERO)?.value;
  if (!valore) return no();
  try {
    const supabase = await getServerSupabase();
    const { data: utente, error } = await supabase.auth.getUser();
    if (error || !utente?.user) return no();
    const { data } = await supabase.auth.getSession();
    const sessione = sessioneDelGettone(data.session?.access_token);
    if (!verificaSegnoRecupero(valore, sessione)) return no();
    return NextResponse.json({ recupero: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return no();
  }
}

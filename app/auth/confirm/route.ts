import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env, requireSupabasePublic } from '@/lib/env';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  destinazioneDopoLaConferma,
  leggiLinkDiConferma,
  rimandoLinkNonRiuscito,
} from '@/lib/auth/link-email';
import { vaChiestaLAccettazione, verbalizzaAccettazione, versioneAccettata } from '@/lib/auth/accettazione-testi';

export const runtime = 'nodejs';

/**
 * 15/10/2026 (R13) — LA CONFERMA CHE FUNZIONA DA QUALUNQUE DISPOSITIVO.
 *
 * Il link dell'email porta un `token_hash`. Qui il server lo verifica con
 * `verifyOtp` e scrive i cookie della sessione: non serve nessun segreto
 * rimasto nel browser che ha fatto la richiesta, quindi la password chiesta dal
 * computer si cambia anche aprendo l'email dal telefono, e l'iscrizione fatta
 * dal telefono si conferma anche dal computer.
 *
 * Diventa la strada di tutti quando i modelli «Reset password» e «Confirm
 * signup» su Supabase puntano qui. Finche' non lo fanno, /auth/callback resta
 * in servizio per i link di oggi.
 *
 * La logica che decide sta in `lib/auth/link-email.ts`; qui solo i fili.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const link = leggiLinkDiConferma(url.searchParams);
  if (!link.valido) {
    return NextResponse.redirect(new URL(rimandoLinkNonRiuscito(link.tipo, 'link_non_valido', link.next), env.appUrl()));
  }

  const { url: supaUrl, key: supaKey } = requireSupabasePublic();
  // Raccoglie i cookie che Supabase scrive durante la verifica: vanno copiati
  // su qualunque risposta parta da qui, altrimenti la sessione si perde.
  const raccolta = NextResponse.redirect(new URL(link.next, env.appUrl()));
  const supabase = createServerClient(supaUrl, supaKey, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        raccolta.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        raccolta.cookies.set({ name, value: '', ...options });
      },
    },
  });

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.tipo });
  if (error || !data?.session) {
    logger.warn('[auth/confirm] link non verificato', { tipo: link.tipo, codice: error?.code ?? null });
    return NextResponse.redirect(new URL(rimandoLinkNonRiuscito(link.tipo, 'link_scaduto', link.next), env.appUrl()));
  }

  const conICookie = (dove: URL) => {
    const r = NextResponse.redirect(dove);
    for (const c of raccolta.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  const utente = data.user;
  if (link.tipo !== 'recovery' && utente) {
    // Lo stesso verbale del ritorno da /auth/callback: chi conferma da qui non
    // deve restare operativo senza una riga che dica cosa ha accettato.
    const versione = versioneAccettata(utente, null);
    try {
      const admin = getAdminSupabase();
      if (versione) {
        await verbalizzaAccettazione(admin, {
          utenteId: utente.id,
          versione,
          ip: getClientIp(req),
          userAgent: req.headers.get('user-agent'),
        });
      } else if (await vaChiestaLAccettazione(admin, utente.id)) {
        const chiedi = new URL('/accetta-condizioni', env.appUrl());
        chiedi.searchParams.set('next', link.next);
        return conICookie(chiedi);
      }
    } catch (e) {
      logger.warn('[auth/confirm] accettazione dei testi non registrata', { e });
    }
  }

  return conICookie(destinazioneDopoLaConferma(env.appUrl(), link));
}

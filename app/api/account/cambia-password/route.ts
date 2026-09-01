import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { LUNGHEZZA_MINIMA } from '@/lib/account/cambio-password';

export const runtime = 'nodejs';

/**
 * IL CAMBIO PASSWORD SI CONTROLLA SUL SERVER, NON NEL BROWSER.
 *
 * 27/8/2026 (R019) — La verifica della password attuale viveva dentro
 * `app/profile/settings/page.tsx`, che è un componente client: prima
 * `supabase.auth.signInWithPassword({ email, password: currentPassword })`,
 * poi `supabase.auth.updateUser({ password })`. Due chiamate indipendenti,
 * tutte e due dal browser.
 *
 * Chi controlla quella pagina — la console degli strumenti per sviluppatori,
 * un'estensione ostile, uno script iniettato — chiamava direttamente la SECONDA
 * e saltava la prima. Il commento sopra descriveva esattamente la minaccia che
 * voleva chiudere («un telefono lasciato sbloccato… cioè prendersi
 * l'account»), e il controllo messo non la chiudeva: una sessione rubata
 * diventava un account perso per sempre, perché con la password cambiata il
 * proprietario vero non rientra più. Su un venditore vuol dire negozio,
 * catalogo e conto Stripe collegato al payout.
 *
 * Qui la verifica e il cambio sono UNA cosa sola, e stanno dove il browser non
 * arriva. La password attuale si prova con un client anonimo appena creato —
 * non quello della sessione, che è già dentro — e solo se combacia si scrive
 * quella nuova con il client di servizio.
 */
const Corpo = z.object({
  passwordAttuale: z.string().min(1).max(200),
  nuovaPassword: z.string().min(LUNGHEZZA_MINIMA).max(200),
});

export const POST = withAuthRateLimit(
  // Cinque tentativi ogni quarto d'ora: chi cambia la password lo fa una volta,
  // e questa rotta è anche un modo per PROVARE password (la risposta dice se
  // quella attuale era giusta). Il freno è quindi parte della difesa.
  { name: 'cambia-password', max: 5, windowMs: 15 * 60_000 },
  async ({ user, req }): Promise<NextResponse> => {
    let corpo;
    try {
      corpo = Corpo.parse(await jsonRichiesta(req, TETTO_JSON));
    } catch {
      return ApiErrors.invalidRequest(
        `La nuova password deve essere di almeno ${LUNGHEZZA_MINIMA} caratteri.`,
      );
    }

    const email = user.email?.trim();
    if (!email) {
      // Chi è entrato solo con Google non ha una password da cambiare: mandarlo
      // avanti gli scriverebbe una password che non ha mai chiesto.
      return ApiErrors.conflict('Questo account accede senza password: usa il tuo fornitore di accesso.');
    }

    // Client nuovo e senza sessione: è l'unico modo per PROVARE la password
    // invece di fidarsi di chi sta già dentro. Non tocca la sessione in corso.
    const prova = creaClientAnonimo();
    const { error: erroreVerifica } = await prova.auth.signInWithPassword({
      email,
      password: corpo.passwordAttuale,
    });
    if (erroreVerifica) {
      return ApiErrors.unauthorized('Password attuale non corretta');
    }

    const { error: erroreCambio } = await getAdminSupabase().auth.admin.updateUserById(user.id, {
      password: corpo.nuovaPassword,
    });
    if (erroreCambio) {
      logger.error('[cambia-password] scrittura fallita', { userId: user.id, message: erroreCambio.message });
      return ApiErrors.internal('Non è stato possibile aggiornare la password');
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  },
);

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { writeAudit } from '@/lib/audit';
import { giornoLocale } from '@/lib/tempo/giorno-locale';
import { aggiornaQuadratura } from '@/lib/cassa/quadratura';
import { contanteDaRimettereCents } from '@/lib/shipping';
import {
  COLONNE_ORDINE_DA_INCASSARE,
  campiDellIncasso,
  importoFuoriMisura,
  motivoPerNonRegistrare,
  scriviIncasso,
  type ChiRegistra,
  type OrdineDaIncassare,
} from '@/lib/cassa/registra-incasso';

export const runtime = 'nodejs';

const Body = z.object({
  orderId: z.string().uuid(),
  cashCollectedCents: z.number().int().nonnegative(),
  /** Perche' lo registra l'amministratore e non il fattorino: resta nel registro. */
  nota: z.string().trim().min(5, 'Scrivi chi ha dichiarato i contanti e quando').max(300),
});

/**
 * 15/10/2026 (R33) — L'AMMINISTRATORE REGISTRA I CONTANTI DICHIARATI DAL
 * FATTORINO.
 *
 * La rimessa della sera salta gli ordini in contanti consegnati senza incasso
 * registrato, e lo diceva: «vanno chiesti al fattorino». Ma se il fattorino
 * non rimedia — ha smesso di lavorare con noi, non ha il telefono, non ritrova
 * l'ordine — non c'era un pulsante: restava solo mettere le mani sul database,
 * e intanto il negozio non veniva pagato.
 *
 * Qui l'amministratore registra l'incasso al posto suo, con la stessa scrittura
 * che fa il fattorino (`lib/cassa/registra-incasso.ts`) e tre paletti in piu':
 * solo ordini GIA' consegnati (in strada i contanti li ha in mano il
 * fattorino), una nota obbligatoria su chi li ha dichiarati, e una riga nel
 * registro delle azioni amministrative. `cash_collected_by` e' l'id
 * dell'amministratore: chi guarda l'ordine vede che non l'ha confermato il
 * fattorino.
 *
 * Non rilascia il pagamento da sola: l'ordine resta in attesa di rimessa, e lo
 * sblocca la «Conferma rimessa» di quel giorno, come tutti gli altri.
 */
export const POST = withAdminAuthRateLimit(
  { name: 'admin-cod-incasso-dichiarato', max: 60, windowMs: 60 * 60_000 },
  async ({ user, req }): Promise<NextResponse> => {
    let body;
    try {
      body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
    } catch (e) {
      return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
    }

    const admin = getAdminSupabase();
    const { data: letto, error } = await admin
      .from('orders')
      .select(COLONNE_ORDINE_DA_INCASSARE)
      .eq('id', body.orderId)
      .maybeSingle();
    const ordine = (error ? null : letto) as OrdineDaIncassare | null;

    const chi: ChiRegistra = { chi: 'amministratore', userId: user.id };
    switch (motivoPerNonRegistrare(ordine, chi)) {
      case 'NON_TROVATO': return ApiErrors.notFound('Ordine non trovato');
      case 'NON_IN_CONTANTI': return ApiErrors.conflict('Questo ordine non è in contanti');
      case 'GIA_CONFERMATO': return ApiErrors.conflict('Incasso già confermato');
      case 'SENZA_FATTORINO': return ApiErrors.conflict('Questo ordine non ha un fattorino');
      case 'NON_ANCORA_CONSEGNATO':
        return ApiErrors.conflict('La consegna è ancora in corso: i contanti li conferma il fattorino');
      default: break;
    }
    if (!ordine || !ordine.rider_id) return ApiErrors.notFound('Ordine non trovato');

    if (importoFuoriMisura(ordine, body.cashCollectedCents)) {
      return ApiErrors.invalidRequest('Importo fuori misura rispetto al totale dell’ordine.');
    }

    const adesso = new Date();
    const { data: scritte, error: errScrittura } = await scriviIncasso(
      admin,
      { id: ordine.id, rider_id: ordine.rider_id },
      campiDellIncasso(ordine, { incassatoCents: body.cashCollectedCents, registratoDa: user.id, adesso }),
      chi,
    );
    if (errScrittura) {
      logger.error('[admin] incasso dichiarato non registrato', { orderId: ordine.id, message: errScrittura.message });
      return ApiErrors.internal('Registrazione non riuscita');
    }
    if (!scritte || scritte.length === 0) return ApiErrors.conflict('Incasso già confermato');

    await writeAudit({
      actorId: user.id,
      action: 'order.cash_declared',
      targetTable: 'orders',
      targetId: ordine.id,
      metadata: {
        fattorino: ordine.rider_id,
        incassato_cents: body.cashCollectedCents,
        atteso_cents: contanteDaRimettereCents(ordine),
        nota: body.nota,
      },
    });

    // La giornata di cassa e' quella della consegna: e' quella che la rimessa guarda.
    if (ordine.delivered_at) {
      await aggiornaQuadratura(admin, ordine.rider_id, giornoLocale(new Date(ordine.delivered_at)));
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  },
);

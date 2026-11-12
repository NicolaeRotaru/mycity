import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { normalizzaPartitaIva, partitaIvaValida } from '@/lib/admin/regole-approvazione';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * 12/11/2026 (R08-002) — LA PARTITA IVA DI UN NEGOZIO GIA' APPROVATO.
 *
 * Dal 1/11 l'approvazione pretende una partita IVA valida (moderate/route.ts), ma
 * i negozi approvati prima non l'avevano e non avevano nessuna pagina dove
 * metterla: l'unico modulo, /sell (cioè /api/seller/apply), risponde 409 a chi
 * è già approvato e 403 a chi è sospeso. Per loro «Venduto da» restava senza
 * partita IVA davanti al cliente.
 *
 * Qui la si inserisce UNA volta, e solo se manca:
 *  · solo un negozio approvato o sospeso (chi è in attesa o respinto usa /sell);
 *  · stesso controllo della cifra finale usato dall'approvazione;
 *  · se c'è già, 409: cambiarla è una cosa da assistenza, non da modulo, perché
 *    è il dato con cui il negozio fattura e che il cliente legge;
 *  · la scrittura si rifà condizionata (ruolo e colonna vuota): due invii insieme
 *    ne scrivono uno solo.
 * Gli amministratori ricevono un avviso, così la possono guardare.
 */

const Corpo = z.object({ partitaIva: z.string().min(1).max(32) });

const STATI_AMMESSI = ['approved', 'suspended'] as const;

const vuota = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');

export const POST = withAuthRateLimit(
  { name: 'seller-partita-iva', max: 10, windowMs: 60_000 },
  async ({ user, req }) => {
    let corpo: unknown;
    try {
      corpo = await jsonRichiesta(req, TETTO_JSON);
    } catch (errore) {
      if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
      return ApiErrors.invalidRequest('Richiesta non leggibile');
    }
    const esito = Corpo.safeParse(corpo);
    if (!esito.success) return ApiErrors.invalidRequest('Scrivi la partita IVA.');

    const piva = normalizzaPartitaIva(esito.data.partitaIva);
    if (!partitaIvaValida(piva)) {
      return ApiErrors.invalidRequest('Questa partita IVA non è valida: controlla le 11 cifre.');
    }

    const admin = getAdminSupabase();
    const { data: profilo, error: errLettura } = await admin
      .from('profiles')
      .select('role, approval_status, business_vat_number, store_name')
      .eq('id', user.id)
      .maybeSingle();
    if (errLettura) {
      logger.error('[seller-partita-iva] profilo non leggibile', { userId: user.id, message: errLettura.message });
      return ApiErrors.internal('Non è stato possibile salvare la partita IVA.');
    }
    if (!profilo) return ApiErrors.notFound('Profilo non trovato');
    if (profilo.role !== 'seller') return ApiErrors.forbidden('Solo un negozio può inserire la partita IVA.');
    if (!(STATI_AMMESSI as readonly string[]).includes(String(profilo.approval_status))) {
      return ApiErrors.conflict('Il tuo negozio non è ancora approvato: la partita IVA si mette nel modulo di richiesta (/sell).');
    }
    if (!vuota(profilo.business_vat_number)) {
      return ApiErrors.conflict("La partita IVA c'è già. Per cambiarla scrivi all'assistenza.");
    }

    const { error, count } = await admin
      .from('profiles')
      .update({ business_vat_number: piva }, { count: 'exact' })
      .eq('id', user.id)
      .eq('role', 'seller')
      .in('approval_status', [...STATI_AMMESSI])
      .or('business_vat_number.is.null,business_vat_number.eq.');
    if (error) {
      logger.error('[seller-partita-iva] scrittura fallita', { userId: user.id, message: error.message });
      return ApiErrors.internal('Non è stato possibile salvare la partita IVA.');
    }
    if (count === 0) {
      return ApiErrors.conflict("La partita IVA c'è già. Per cambiarla scrivi all'assistenza.");
    }

    try {
      await notifyAdmins(
        'Partita IVA inserita da un negozio',
        `${profilo.store_name ?? 'Un negozio'} ha inserito la partita IVA dal suo pannello: controllala nella sua scheda.`,
        '/admin/users',
        { unaVoltaPer: `partita-iva:${user.id}` },
      );
    } catch (e) {
      // L'avviso è un di più: la partita IVA è già salvata.
      logger.warn('[seller-partita-iva] avviso agli amministratori non partito', { userId: user.id, err: e instanceof Error ? e.message : String(e) });
    }

    return NextResponse.json({ ok: true, partitaIva: piva });
  },
);

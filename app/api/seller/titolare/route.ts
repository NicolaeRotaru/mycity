import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { controlloEta } from '@/lib/maggiore-eta';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

export const runtime = 'nodejs';

/**
 * I DATI DEL TITOLARE DI UN NEGOZIO GIÀ ISCRITTO — 25/11/2026.
 *
 * Nicola ha accorciato il modulo di iscrizione (/sell) al minimo che serve a
 * riconoscere l'attività: tipo, nome, indirizzo, partita IVA, telefono. Nome,
 * cognome, codice fiscale, data di nascita e residenza del titolare non si
 * chiedono più lì, e nessun'altra pagina li chiedeva: senza questa rotta non si
 * sarebbero più potuti scrivere. Si scrivono subito dopo l'invio, nella pagina
 * «Richiesta in valutazione» di /sell, e poi dal Profilo del negozio
 * (components/seller/DatiDelTitolare), con gli stessi controlli che aveva
 * l'iscrizione, compresa la maggiore età (condizioni d'uso, punto 3; il vincolo
 * vero resta sul database, migrazione 156).
 *
 * Restano privati: non li vede il cliente, li legge solo lo staff.
 */

const DatiDelTitolare = z.object({
  legalFirstName: z.string().trim().min(2, 'Inserisci il nome').max(80),
  legalLastName: z.string().trim().min(2, 'Inserisci il cognome').max(80),
  legalFiscalCode: z.string().trim().regex(/^[A-Z0-9]{11,16}$/i, 'Codice fiscale non valido'),
  legalBirthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Inserisci la data di nascita'),
  legalResidenceAddr: z.string().trim().min(3, 'Inserisci la via di residenza').max(200),
  legalResidenceCity: z.string().trim().min(2, 'Inserisci la città').max(80),
  legalResidenceZip: z.string().trim().regex(/^[0-9]{5}$/, 'CAP non valido'),
});

/** Le colonne del profilo, nello stesso ordine dei campi. */
const COLONNE = {
  legalFirstName: 'legal_first_name',
  legalLastName: 'legal_last_name',
  legalFiscalCode: 'legal_fiscal_code',
  legalBirthDate: 'legal_birth_date',
  legalResidenceAddr: 'legal_residence_addr',
  legalResidenceCity: 'legal_residence_city',
  legalResidenceZip: 'legal_residence_zip',
} as const;

export const PATCH = withAuthRateLimit(
  { name: 'seller-titolare', max: 10, windowMs: 60_000 },
  async ({ user, req }) => {
    let corpo: unknown;
    try {
      corpo = await jsonRichiesta(req, TETTO_JSON);
    } catch (errore) {
      if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
      return ApiErrors.invalidRequest('Richiesta non leggibile');
    }
    const esito = DatiDelTitolare.safeParse(corpo);
    if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
    const f = esito.data;

    const eta = controlloEta(f.legalBirthDate);
    if (!eta.ok) return ApiErrors.invalidRequest(eta.messaggio ?? 'Controlla la data di nascita.');

    const admin = getAdminSupabase();
    const { data: attuale, error: errLettura } = await admin
      .from('profiles')
      .select(`role, approval_status, store_name, ${Object.values(COLONNE).join(', ')}`)
      .eq('id', user.id)
      .maybeSingle();
    if (errLettura) {
      logger.error('[seller-titolare] profilo non leggibile', { userId: user.id, message: errLettura.message });
      return ApiErrors.internal('Non è stato possibile salvare i dati');
    }
    if (!attuale) return ApiErrors.notFound('Profilo non trovato');
    const att = attuale as unknown as Record<string, string | null | undefined>;
    if (att.role !== 'seller') return ApiErrors.forbidden('Solo un negozio può salvare i dati del titolare.');
    if (att.approval_status === 'suspended') {
      return ApiErrors.forbidden("Il tuo negozio è sospeso: per i dati del titolare scrivi all'assistenza.");
    }

    const nuovi: Record<string, string> = {
      legal_first_name: f.legalFirstName,
      legal_last_name: f.legalLastName,
      legal_fiscal_code: f.legalFiscalCode.toUpperCase(),
      legal_birth_date: f.legalBirthDate,
      legal_residence_addr: f.legalResidenceAddr,
      legal_residence_city: f.legalResidenceCity,
      legal_residence_zip: f.legalResidenceZip,
    };

    const { data: scritti, error } = await admin
      .from('profiles')
      .update(nuovi)
      .eq('id', user.id)
      .eq('role', 'seller')
      // 25/11/2026 — `neq` da solo escludeva i negozi con lo stato vuoto: in SQL
      // NULL <> 'suspended' non è vero, quindi 0 righe e un 409 a ogni salvataggio.
      // Stessa cura di /api/rider/anagrafica.
      .or('approval_status.is.null,approval_status.neq.suspended')
      .select('id');
    if (error) {
      logger.error('[seller-titolare] dati non salvati', { userId: user.id, code: error.code, message: error.message });
      return ApiErrors.internal('Non è stato possibile salvare i dati');
    }
    if (!scritti || scritti.length === 0) {
      return ApiErrors.conflict('Lo stato del tuo account è appena cambiato: ricarica la pagina.');
    }

    // Chi cambia i dati di chi firma lo sa subito lo staff: è la stessa regola
    // dei dati fiscali della ditta (PATCH /api/seller/apply). La prima volta no:
    // è il negozio che completa il profilo, non un cambio.
    const cambiati = Object.keys(nuovi).filter(
      (k) => String(att[k] ?? '').trim() !== '' && String(att[k] ?? '').trim() !== nuovi[k].trim(),
    );
    // 25/11/2026 (secondo collaudo) — Un negozio in attesa che li scrive la prima volta: lo staff
    // aveva trovato «mancano i dati del titolare» all'approvazione, e senza avviso non sa quando
    // riprovare. La promessa delle 48 ore conta da lì.
    const primaVoltaInAttesa =
      att.approval_status === 'pending' && Object.keys(nuovi).some((k) => String(att[k] ?? '').trim() === '');
    if (primaVoltaInAttesa) {
      try {
        await notifyAdmins(
          'Dati del titolare inseriti',
          `${att.store_name ?? 'Un negozio in attesa'} ha scritto i dati di chi firma: ora si può approvare da Utenti.`,
          '/admin/users',
        );
      } catch (errore) {
        logger.error('[seller-titolare] avviso dei dati inseriti non partito', { userId: user.id, errore });
      }
    }
    if (cambiati.length > 0) {
      try {
        await notifyAdmins(
          'Dati del titolare cambiati',
          `${att.store_name ?? 'Un negozio'} ha cambiato: ${cambiati.join(', ')}. Controlla che siano ancora quelli giusti.`,
          '/admin/users',
        );
      } catch (errore) {
        logger.error('[seller-titolare] avviso del cambio non partito', { userId: user.id, errore });
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  },
);

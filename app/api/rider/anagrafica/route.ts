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
 * L'ANAGRAFICA DEL FATTORINO SI SCRIVE DAL SERVER — 25/11/2026.
 *
 * Il passo 1 di /rider/onboarding (nome, cognome, codice fiscale, data di
 * nascita) scriveva queste colonne direttamente col client Supabase del
 * browser. La migrazione 861 le toglie dall'elenco dei campi che una persona
 * può cambiare di sé, come la 365 ha fatto per IBAN e dati fiscali: da lì in
 * poi l'unica strada è questa rotta, con gli stessi controlli della rotta del
 * titolare di un negozio (PATCH /api/seller/titolare):
 *  · il formato (nome e cognome di almeno due lettere, codice fiscale di 11-16
 *    lettere e cifre, data vera);
 *  · i 18 anni compiuti (condizioni d'uso, punto 3; il vincolo vero resta sul
 *    database, migrazione 156);
 *  · un fattorino sospeso non li cambia da solo;
 *  · se un dato già scritto cambia, lo staff lo sa subito: chi consegna con un
 *    nome diverso da quello controllato sui documenti è un fatto da guardare.
 *
 * La prima volta non si avvisa: è il fattorino che compila l'iscrizione, e la
 * verifica dei documenti (/api/kyc/start-check) apre già la revisione dello
 * staff, col sorvegliante delle 48 ore (operational-alerts).
 */

const AnagraficaDelFattorino = z.object({
  legalFirstName: z.string().trim().min(2, 'Inserisci il nome').max(80),
  legalLastName: z.string().trim().min(2, 'Inserisci il cognome').max(80),
  legalFiscalCode: z.string().trim().regex(/^[A-Z0-9]{11,16}$/i, 'Codice fiscale non valido'),
  legalBirthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Inserisci la data di nascita'),
});

/** Le colonne del profilo, nello stesso ordine dei campi. */
const COLONNE = ['legal_first_name', 'legal_last_name', 'legal_fiscal_code', 'legal_birth_date'] as const;

export const PATCH = withAuthRateLimit(
  { name: 'rider-anagrafica', max: 10, windowMs: 60_000 },
  async ({ user, req }) => {
    let corpo: unknown;
    try {
      corpo = await jsonRichiesta(req, TETTO_JSON);
    } catch (errore) {
      if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
      return ApiErrors.invalidRequest('Richiesta non leggibile');
    }
    const esito = AnagraficaDelFattorino.safeParse(corpo);
    if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
    const f = esito.data;

    const eta = controlloEta(f.legalBirthDate);
    if (!eta.ok) return ApiErrors.invalidRequest(eta.messaggio ?? 'Controlla la data di nascita.');

    const admin = getAdminSupabase();
    const { data: attuale, error: errLettura } = await admin
      .from('profiles')
      .select(`role, approval_status, full_name, ${COLONNE.join(', ')}`)
      .eq('id', user.id)
      .maybeSingle();
    if (errLettura) {
      logger.error('[rider-anagrafica] profilo non leggibile', { userId: user.id, message: errLettura.message });
      return ApiErrors.internal('Non è stato possibile salvare i dati');
    }
    if (!attuale) return ApiErrors.notFound('Profilo non trovato');
    const att = attuale as unknown as Record<string, string | null | undefined>;
    if (att.role !== 'rider') return ApiErrors.forbidden('Solo un fattorino può salvare questi dati da qui.');
    if (att.approval_status === 'suspended') {
      return ApiErrors.forbidden("Il tuo account è sospeso: per cambiare i tuoi dati scrivi all'assistenza.");
    }

    const nuovi: Record<(typeof COLONNE)[number], string> = {
      legal_first_name: f.legalFirstName,
      legal_last_name: f.legalLastName,
      legal_fiscal_code: f.legalFiscalCode.toUpperCase(),
      legal_birth_date: f.legalBirthDate,
    };

    // Lo stato si ricontrolla nella scrittura stessa: se lo staff sospende il fattorino fra la
    // lettura e qui, non si scrive niente. Uno stato vuoto (NULL) non è «sospeso»: `neq` da solo
    // lo escluderebbe, perché in SQL NULL <> 'suspended' non è vero.
    const { data: scritti, error } = await admin
      .from('profiles')
      .update(nuovi)
      .eq('id', user.id)
      .eq('role', 'rider')
      .or('approval_status.is.null,approval_status.neq.suspended')
      .select('id');
    if (error) {
      logger.error('[rider-anagrafica] dati non salvati', { userId: user.id, code: error.code, message: error.message });
      return ApiErrors.internal('Non è stato possibile salvare i dati');
    }
    if (!scritti || scritti.length === 0) {
      return ApiErrors.conflict('Lo stato del tuo account è appena cambiato: ricarica la pagina.');
    }

    // Un dato già scritto che cambia: lo staff lo sa subito (stessa regola del titolare di un negozio).
    const cambiati = COLONNE.filter(
      (k) => String(att[k] ?? '').trim() !== '' && String(att[k] ?? '').trim() !== nuovi[k].trim(),
    );
    if (cambiati.length > 0) {
      try {
        await notifyAdmins(
          'Dati del fattorino cambiati',
          `${att.full_name?.trim() || 'Un fattorino'} ha cambiato: ${cambiati.join(', ')}. Controlla che corrispondano ai documenti.`,
          '/admin/users',
        );
      } catch (errore) {
        logger.error('[rider-anagrafica] avviso del cambio non partito', { userId: user.id, errore });
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  },
);

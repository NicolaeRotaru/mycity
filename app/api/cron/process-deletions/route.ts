import { NextResponse, type NextRequest } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Cron job giornaliero: processa account deletion scadute (cooldown 7gg).
 *
 * Esperti consultati:
 * - SRE: "Cron giornaliero ore 04:00 UTC = traffico minimo, no impatto utenti."
 * - GDPR Compliance: "Hard delete dopo 7gg = soddisfa Art.17 'senza
 *   giustificato ritardo' con grace period documentato."
 *
 * Pipeline per ogni account scaduto:
 *  1) Anonimizza profilo (rimuove PII)
 *  2) Cancella riga auth.users (sessione invalidata)
 *  3) Log audit per compliance
 *
 * Setup cron esterno (es. cron-job.org, Render cron):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/process-deletions
 *
 * Schedule consigliato: ogni giorno alle 04:00 Europe/Rome.
 */

const SAFE_FIELDS = {
  full_name: '[utente eliminato]',
  phone: null,
  address: null,
  city: null,
  zip: null,
  store_name: null,
  store_phone: null,
  store_address: null,
  store_lat: null,
  store_lng: null,
  store_logo: null,
  store_media: null,
  store_description: null,
  is_approved: false,
  role: 'buyer',
  deletion_requested_at: null,
};

const KYC_FIELDS = {
  legal_first_name: null,
  legal_last_name: null,
  legal_fiscal_code: null,
  legal_birth_date: null,
  legal_residence_addr: null,
  legal_residence_city: null,
  legal_residence_zip: null,
  business_legal_name: null,
  business_vat_number: null,
  business_address: null,
  business_city: null,
  business_zip: null,
  business_pec: null,
  business_sdi: null,
  billing_iban: null,
  billing_card_last4: null,
  approval_status: 'rejected',
  // Gli indirizzi dei documenti: carta d'identità (fronte e retro), selfie,
  // patente, assicurazione e attestato alimentare. Prima restavano scritti nel
  // profilo dopo la cancellazione — e i file restavano nello storage.
  kyc_id_doc_front_url: null,
  kyc_id_doc_back_url: null,
  kyc_selfie_url: null,
  rider_license_url: null,
  rider_insurance_url: null,
  rider_haccp_url: null,
};

/** Secchi che possono contenere file personali di un utente. */
const SECCHI_CON_FILE_PERSONALI = ['kyc-docs', 'cod-proof'] as const;

/**
 * Cancella i file dell'utente dallo storage.
 *
 * Serve perché azzerare la colonna che punta al file non cancella il file: le
 * carte d'identità e i selfie restavano nello storage per sempre. Un giro sul
 * codice non trovava NESSUNA chiamata a `.remove()`: nessuno li aveva mai
 * cancellati.
 */
async function cancellaFilePersonali(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
): Promise<{ rimossi: number; errori: string[] }> {
  let rimossi = 0;
  const errori: string[] = [];

  for (const secchio of SECCHI_CON_FILE_PERSONALI) {
    try {
      const { data: elenco, error } = await admin.storage.from(secchio).list(userId, { limit: 1000 });
      if (error) { errori.push(`${secchio}: ${error.message}`); continue; }
      if (!elenco || elenco.length === 0) continue;

      // Un livello di sottocartelle (per esempio cod-proof/<utente>/<ordine>/).
      const percorsi: string[] = [];
      for (const voce of elenco) {
        if (voce.id === null) {
          const { data: dentro } = await admin.storage
            .from(secchio)
            .list(`${userId}/${voce.name}`, { limit: 1000 });
          for (const f of dentro ?? []) percorsi.push(`${userId}/${voce.name}/${f.name}`);
        } else {
          percorsi.push(`${userId}/${voce.name}`);
        }
      }
      if (percorsi.length === 0) continue;

      const { error: errRimozione } = await admin.storage.from(secchio).remove(percorsi);
      if (errRimozione) errori.push(`${secchio}: ${errRimozione.message}`);
      else rimossi += percorsi.length;
    } catch (e) {
      errori.push(`${secchio}: ${e instanceof Error ? e.message : 'errore'}`);
    }
  }
  return { rimossi, errori };
}

export const POST = withCronAuth(async (_req: NextRequest): Promise<NextResponse> => {
  const admin = getAdminSupabase();

  // 🟡-15: enforcement della retention documentata (privacy §3) per i log che
  // contengono PII (IP/user-agent). I periodi sono dichiarati nella privacy:
  // log di sicurezza/accesso 12 mesi, analitica 14 mesi. Qui rimuoviamo l'IP/UA
  // oltre quei periodi (l'azione/evento resta, la PII no). Best-effort, idempotente.
  try {
    const monthsAgo = (m: number) => new Date(Date.now() - m * 30 * 86_400_000).toISOString();
    await admin
      .from('activity_events')
      .update({ ip: null, user_agent: null })
      .lt('created_at', monthsAgo(14))
      .not('ip', 'is', null);
    // Fix #33: la retention dichiarata (14 mesi) non annullava anon_id/path/city/referrer.
    // Oltre 14 mesi azzeriamo anche il profilo comportamentale pseudonimo (art. 5.1.e GDPR).
    await admin
      .from('activity_events')
      .update({ anon_id: null, path: null, referrer: null, city: null, country: null })
      .lt('created_at', monthsAgo(14))
      .not('anon_id', 'is', null);
    await admin
      .from('audit_logs')
      .update({ ip: null, user_agent: null })
      .lt('created_at', monthsAgo(12))
      .not('ip', 'is', null);

    // `metadata` e `summary` restavano intatti: sono i campi che contengono i
    // valori vecchi e nuovi delle colonne cambiate, quindi la parte piu'
    // personale della riga. Azzerarli oltre la finestra dichiarata.
    await admin
      .from('activity_events')
      .update({ metadata: null, summary: null })
      .lt('created_at', monthsAgo(14))
      .not('metadata', 'is', null);
    await admin
      .from('audit_logs')
      .update({ metadata: null })
      .lt('created_at', monthsAgo(12))
      .not('metadata', 'is', null);

    // E le righe di semplice navigazione si cancellano, non si sbiancano: senza
    // questo la tabella cresceva per sempre. Le altre categorie restano perche'
    // servono da traccia di sicurezza e contabile.
    await admin
      .from('activity_events')
      .delete()
      .eq('category', 'visitor')
      .lt('created_at', monthsAgo(14));

    // I messaggi dal modulo contatti oltre due anni non servono piu' a nessuno.
    await admin
      .from('contact_messages')
      .delete()
      .lt('created_at', monthsAgo(24));
  } catch (e) {
    logger.warn('[cron-deletions] prune retention IP/UA parziale', { e });
  }

  // Chiama la function SQL che ritorna gli userId scaduti
  const { data: expired, error: rpcErr } = await admin.rpc('process_expired_deletions');
  if (rpcErr) {
    logger.error('[cron-deletions] RPC failed', rpcErr);
    return ApiErrors.internal(rpcErr.message);
  }

  const userIds: string[] = (expired ?? []).map((r: { user_id: string }) => r.user_id);
  if (userIds.length === 0) {
    return NextResponse.json({ processed: 0, message: 'No accounts to process' });
  }

  const results = { ok: 0, failed: 0, errors: [] as string[] };

  for (const userId of userIds) {
    // 1) Anonimizza (resilient pattern: full → safe fallback).
    // IMPORTANTE: i dati KYC (CF, IBAN, nomi legali) vanno sempre cancellati,
    // anche nel fallback — mai lasciarli in chiaro dopo una deletion (Art.17 GDPR).
    const full = await admin.from('profiles').update({ ...SAFE_FIELDS, ...KYC_FIELDS }).eq('id', userId);
    if (full.error) {
      logger.warn('[cron-deletions] full anonymize failed, fallback', { userId, err: full.error.message });
      const safe = await admin.from('profiles').update(SAFE_FIELDS).eq('id', userId);
      if (safe.error) {
        results.failed++;
        results.errors.push(`${userId}: anonymize failed`);
        continue;
      }
      // Tenta comunque di cancellare i dati KYC separatamente (best-effort ma obbligatorio).
      await admin.from('profiles').update(KYC_FIELDS).eq('id', userId)
        .then(({ error: kycErr }) => {
          if (kycErr) logger.warn('[cron-deletions] KYC fields cleanup parziale', { userId, err: kycErr.message });
        });
    }

    // 1b) 🟡-14: anonimizza il free-text PII dell'utente oltre al profilo (Art.17).
    // Recensioni/resi/chat/contact possono contenere dati personali in chiaro.
    // Best-effort: non blocca la cancellazione se una singola tabella fallisce.
    await Promise.all([
      admin.from('reviews').update({ comment: null }).eq('user_id', userId),
      admin.from('store_reviews').update({ comment: null }).eq('user_id', userId),
      admin.from('rider_reviews').update({ comment: null }).eq('user_id', userId),
      admin.from('returns').update({ notes: null }).eq('buyer_id', userId),
      admin.from('messages').update({ body: '[messaggio rimosso]' }).eq('sender_id', userId),
      admin
        .from('contact_messages')
        .update({ name: '[eliminato]', email: '[eliminato]', message: '[rimosso]' })
        .eq('user_id', userId),
    ]).catch((e) => logger.warn('[cron-deletions] anonimizzazione free-text parziale', { userId, e }));

    // 1c) I file personali nello storage. Va fatto PRIMA della cancellazione
    // dell'utente: dopo, l'elenco delle sue cartelle non e' piu' ricostruibile.
    const file = await cancellaFilePersonali(admin, userId);
    if (file.errori.length > 0) {
      logger.warn('[cron-deletions] file personali non tutti rimossi', { userId, errori: file.errori });
    }

    // 2) Hard delete auth.users
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      logger.error('[cron-deletions] auth delete failed', { userId, err: delErr.message });
      results.failed++;
      results.errors.push(`${userId}: auth delete failed`);
      continue;
    }

    results.ok++;
    logger.info('[cron-deletions] processed', { userId });
  }

  return NextResponse.json({
    processed: results.ok,
    failed: results.failed,
    errors: results.errors,
    total: userIds.length,
  });
});

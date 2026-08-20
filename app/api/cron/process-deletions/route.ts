import { NextResponse, type NextRequest } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { cancellaAccount } from '@/lib/account/cancellazione';

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
    // 077 — `consent_log` era l'unica tabella con dati personali che nessuna
    // pulizia toccava: l'indirizzo di rete restava li' per sempre. La PROVA del
    // consenso va conservata (e' l'accountability dell'art. 7.1), l'indirizzo di
    // rete no: dopo 24 mesi — il ciclo di rinnovo semestrale piu' un margine di
    // contenzioso — non serve piu' a niente.
    await admin
      .from('consent_log')
      .update({ ip: null, user_agent: null })
      .lt('created_at', monthsAgo(24))
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

    // 098 — `product_views` cresceva senza fine: una riga per ogni visita a una
    // scheda, per sempre, mentre la tabella accanto veniva potata da mesi. Ma il
    // negoziante non deve perdere lo storico. La funzione prima SALVA il conto
    // giornaliero, poi cancella le righe singole: la riga grezza dura 90 giorni,
    // il numero resta per sempre.
    const { data: consolidate, error: errVisite } = await admin
      .rpc('consolida_visite_prodotto', { p_giorni: 90 });
    if (errVisite) {
      logger.warn('[cron-deletions] consolidamento visite prodotto fallito', { err: errVisite.message });
    } else {
      logger.info('[cron-deletions] visite prodotto consolidate', { consolidate });
    }

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
    // #178 — La stessa pipeline che usa la cancellazione fatta
    // dall'amministratore: anonimizza il profilo e i dati di verifica
    // identita', anonimizza il testo libero, toglie dalla newsletter, cancella
    // i file dallo storage e infine l'account. Prima erano due elenchi di passi
    // scritti in due file, e uno dei due era piu' corto.
    const esito = await cancellaAccount(admin, userId);
    if (!esito.ok) {
      logger.error('[cron-deletions] cancellazione fallita', { userId, errore: esito.errore });
      results.failed++;
      results.errors.push(`${userId}: ${esito.errore ?? 'errore'}`);
      continue;
    }

    results.ok++;
    logger.info('[cron-deletions] processed', { userId, fileRimossi: esito.fileRimossi });
  }

  return NextResponse.json({
    processed: results.ok,
    failed: results.failed,
    errors: results.errors,
    total: userIds.length,
  });
});

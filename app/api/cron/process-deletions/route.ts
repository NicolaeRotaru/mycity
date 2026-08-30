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
 * Cadenza: ogni notte alle 4. Chi la fa partire sta in `vercel.json` → `crons`.
 * A mano si chiama così:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/process-deletions
 *
 * Schedule consigliato: ogni giorno alle 04:00 Europe/Rome.
 */




type Admin = ReturnType<typeof getAdminSupabase>;

/**
 * Fa scadere i file di un secchio, con la regola scritta nel database.
 *
 * Il database non puo' parlare con lo storage: sono due mondi separati. Quindi
 * la funzione SQL azzera le colonne e restituisce i percorsi dei file, e qui si
 * tolgono i file veri. Se si facesse il contrario — prima i file, poi le
 * colonne — un guasto a meta' lascerebbe righe che puntano a fotografie che non
 * esistono piu'; cosi' invece il caso peggiore e' un file orfano nello storage,
 * che nessuna pagina sa piu' mostrare.
 *
 * Best-effort: un errore qui non deve far saltare il resto della notte.
 */
async function potaFileScaduti(
  admin: Admin,
  funzione: 'documenti_da_cancellare_respinti' | 'foto_consegna_da_cancellare',
  secchio: 'kyc-docs' | 'cod-proof',
  giorni = 90,
): Promise<void> {
  const { data, error } = await admin.rpc(funzione, { p_giorni: giorni });
  if (error) {
    logger.warn('[cron-deletions] potatura file scaduti fallita', { funzione, err: error.message });
    return;
  }
  let tolti = 0;
  for (const riga of (data ?? []) as Array<{ percorsi: string[] | null }>) {
    const percorsi = (riga.percorsi ?? []).filter(Boolean);
    if (percorsi.length === 0) continue;
    const { error: errRimozione } = await admin.storage.from(secchio).remove(percorsi);
    if (errRimozione) {
      // I percorsi finiscono nel registro apposta: la colonna che li teneva e'
      // gia' stata azzerata, quindi senza questa riga il file resterebbe nello
      // storage e nessuno saprebbe piu' dove cercarlo.
      logger.warn('[cron-deletions] file scaduti non rimossi', {
        secchio, err: errRimozione.message, percorsi,
      });
      continue;
    }
    tolti += percorsi.length;
  }
  logger.info('[cron-deletions] file scaduti rimossi', { funzione, secchio, tolti });
}

export const POST = withCronAuth(async (_req: NextRequest): Promise<NextResponse> => {
  const admin = getAdminSupabase();

  // 🟡-15: enforcement della retention documentata (privacy §3) per i log che
  // contengono PII (IP/user-agent). I periodi sono dichiarati nella privacy:
  // log di sicurezza/accesso 12 mesi, analitica 14 mesi. Qui rimuoviamo l'IP/UA
  // oltre quei periodi (l'azione/evento resta, la PII no). Best-effort, idempotente.
  try {
    const monthsAgo = (m: number) => new Date(Date.now() - m * 30 * 86_400_000).toISOString();
    // 27/8/2026 (R059) — ERANO 14 MESI, E NE AVEVAMO DICHIARATI 12.
    //
    // Nella tabella della conservazione, sulla riga «Sicurezza, anti-frode»,
    // c'e' scritto «12 mesi (log accessi)». Qui ne stavano quattordici. Un
    // periodo piu' lungo di quello che abbiamo dichiarato noi stessi non e' una
    // svista da poco: in un controllo e' una contestazione che ci siamo scritti
    // da soli, sulla nostra pagina pubblica.
    await admin
      .from('activity_events')
      .update({ ip: null, user_agent: null })
      .lt('created_at', monthsAgo(12))
      .not('ip', 'is', null);
    // 077 — `consent_log` era l'unica tabella con dati personali che nessuna
    // pulizia toccava: l'indirizzo di rete restava li' per sempre. La PROVA del
    // consenso va conservata (e' l'accountability dell'art. 7.1), l'indirizzo di
    // rete no: dopo 24 mesi — il ciclo di rinnovo semestrale piu' un margine di
    // contenzioso — non serve piu' a niente.
    //
    // 27/8/2026 (R066) — IL NUMERO DI MESI VIVEVA IN DUE POSTI.
    // Qui c'era un aggiornamento scritto a mano a 24 mesi, e nel database una
    // funzione `pota_consent_log` che diceva 12 e che non chiamava nessuno. Due
    // regole per la stessa cosa: alla prima modifica una delle due sarebbe
    // rimasta indietro, e l'informativa avrebbe smesso di dire il vero. Adesso
    // il numero sta solo dentro la funzione (migrations/135) e si chiama senza
    // argomenti, cosi' non c'e' un secondo posto da ricordarsi di cambiare.
    const { data: consensiPotati, error: errConsensi } = await admin.rpc('pota_consent_log');
    if (errConsensi) {
      logger.warn('[cron-deletions] potatura registro consensi fallita', { err: errConsensi.message });
    } else {
      logger.info('[cron-deletions] registro consensi potato', { consensiPotati });
    }

    // Fix #33: la retention dichiarata (14 mesi) non annullava anon_id/path/city/referrer.
    // Oltre 14 mesi azzeriamo anche il profilo comportamentale pseudonimo (art. 5.1.e GDPR).
    //
    // 27/8/2026 (R059) — QUI C'ERA UN FILTRO CHE SALTAVA DELLE RIGHE.
    // C'era anche `.not('anon_id','is',null)`, cioe' «ripulisci solo le righe
    // che hanno gia' un identificativo anonimo». Le righe scritte dai trigger
    // del database non ce l'hanno: pagina, referente, citta' e paese restavano
    // li' per sempre proprio sulle righe che nessuno andava a guardare.
    // L'aggiornamento e' idempotente: rifarlo su una riga gia' pulita non costa
    // niente, mentre saltarla costa un dato personale conservato a vita.
    await admin
      .from('activity_events')
      .update({ anon_id: null, path: null, referrer: null, city: null, country: null })
      .lt('created_at', monthsAgo(14));
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

    // 27/8/2026 (R059) — LE RIGHE DI ACCESSO NON SE NE ANDAVANO MAI.
    //
    // Qui si cancellava solo la categoria `visitor`, cioe' la navigazione. Gli
    // eventi di accesso — entrata, uscita, registrazione, categoria `auth` —
    // restavano per sempre: chi sei, da che apparecchio, con che programma, in
    // che giorno e a che ora. Un archivio di accessi che cresce senza fine e'
    // anche il bottino peggiore da lasciare in mano a un intruso.
    //
    // La finestra e' la stessa che dichiariamo per i log di accesso: 12 mesi.
    await admin
      .from('activity_events')
      .delete()
      .eq('category', 'auth')
      .lt('created_at', monthsAgo(12));

    // I messaggi dal modulo contatti oltre due anni non servono piu' a nessuno.
    await admin
      .from('contact_messages')
      .delete()
      .lt('created_at', monthsAgo(24));

    // 27/8/2026 (R056) — I DOCUMENTI DI CHI VIENE RESPINTO.
    //
    // La funzione esisteva dalla migrazione 119 col commento «il cron cancella
    // i file dallo storage», e nessun cron la chiamava. Adesso la chiama questo,
    // e la funzione (riscritta in migrations/135) azzera davvero le colonne e
    // restituisce i percorsi: il database non parla con lo storage, i file li
    // toglie chi puo' farlo.
    await potaFileScaduti(admin, 'documenti_da_cancellare_respinti', 'kyc-docs');

    // 27/8/2026 (R058) — LE FOTO DELLA CONSEGNA IN CONTANTI.
    // I contanti, la firma e «il pacco lasciato» — cioe' quasi sempre la porta
    // di casa del cliente. Stanno nella cartella del FATTORINO, quindi quando
    // il cliente cancellava l'account non venivano nemmeno cercate. Novanta
    // giorni dalla consegna: il tempo della quadratura di cassa e di un
    // reclamo. Dopo, e' la fotografia di una casa e basta.
    await potaFileScaduti(admin, 'foto_consegna_da_cancellare', 'cod-proof');
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

// I lavori periodici di Vercel bussano in GET, sempre — non c'è modo di
// chiedergli un POST. Questa rotta nasceva POST-e-basta, dai tempi del cron
// esterno: su Vercel avrebbe risposto «405 metodo non ammesso» a ogni giro, e
// il lavoro non sarebbe mai partito. Stesso identico handler, stesso controllo
// del segreto: cambia solo la porta da cui si entra. Il POST resta valido
// perché il cron esterno continua a girare finché non lo spegni.
export const GET = POST;

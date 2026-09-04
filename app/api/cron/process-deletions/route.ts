import { NextResponse, type NextRequest } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { cancellaAccount } from '@/lib/account/cancellazione';
import {
  verdettoDelGiro,
  type TentativoCancellazione,
  type VerdettoGiro,
} from '@/lib/cron-cancellazioni';

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

/**
 * 30/8/2026 (R169) — UNA PULIZIA RIFIUTATA NON PASSA PIU' PER FATTA.
 *
 * Nessuna delle sei pulizie di ritenzione guardava l'esito. PostgREST non
 * lancia: torna un oggetto con dentro l'errore, e il `try/catch` che sta
 * intorno non lo vede. Una pulizia negata dai permessi lasciava i dati dov'erano
 * e il lavoro rispondeva «fatto» lo stesso — quindi nessun allarme e nessun
 * sospetto, mentre la finestra dichiarata nella pagina pubblica smetteva di
 * essere vera.
 *
 * Qui l'errore si conta e si scrive. Il conto esce nella risposta del lavoro,
 * cosi' chi guarda i lavori periodici vede la differenza fra «pulito» e
 * «provato a pulire».
 */
async function pota(
  cosa: string,
  scrittura: PromiseLike<{ error: { message: string } | null }>,
  fallite: { n: number },
): Promise<void> {
  const { error } = await scrittura;
  if (error) {
    fallite.n++;
    logger.error('[cron-deletions] pulizia non riuscita: i dati oltre la finestra restano dove sono', {
      cosa, message: error.message,
    });
  }
}

export const POST = withCronAuth(async (_req: NextRequest): Promise<NextResponse> => {
  const admin = getAdminSupabase();
  /** Quante pulizie di ritenzione non sono riuscite: esce nella risposta. */
  const fallite = { n: 0 };

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
    await pota('activity_events.ip', admin
      .from('activity_events')
      .update({ ip: null, user_agent: null })
      .lt('created_at', monthsAgo(12))
      .not('ip', 'is', null), fallite);
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
    await pota('activity_events.profilo', admin
      .from('activity_events')
      .update({ anon_id: null, path: null, referrer: null, city: null, country: null })
      .lt('created_at', monthsAgo(14)), fallite);
    await pota('audit_logs.ip', admin
      .from('audit_logs')
      .update({ ip: null, user_agent: null })
      .lt('created_at', monthsAgo(12))
      .not('ip', 'is', null), fallite);

    // `metadata` e `summary` restavano intatti: sono i campi che contengono i
    // valori vecchi e nuovi delle colonne cambiate, quindi la parte piu'
    // personale della riga. Azzerarli oltre la finestra dichiarata.
    // 30/8/2026 (R169) — IL FILTRO GUARDAVA UNA COLONNA E LA PULIZIA NE TOCCAVA DUE.
    //
    // C'era `.not('metadata','is',null)`, cioe' «ripulisci solo le righe che
    // hanno i dati grezzi». Ma `metadata` lo scrive solo la PRIMA vista di una
    // sessione: quasi tutte le righe ce l'hanno vuoto, e quelle non venivano
    // nemmeno guardate. Il loro `summary` — la frase che racconta cosa e'
    // successo, indirizzi e ricerche comprese — restava li' per sempre, oltre i
    // quattordici mesi che promettiamo nella pagina pubblica.
    //
    // Adesso il filtro guarda le stesse due colonne che la pulizia azzera.
    await pota('activity_events.riassunto', admin
      .from('activity_events')
      .update({ metadata: null, summary: null })
      .lt('created_at', monthsAgo(14))
      .or('metadata.not.is.null,summary.not.is.null'), fallite);
    await pota('audit_logs.metadata', admin
      .from('audit_logs')
      .update({ metadata: null })
      .lt('created_at', monthsAgo(12))
      .not('metadata', 'is', null), fallite);

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
    await pota('activity_events.navigazione', admin
      .from('activity_events')
      .delete()
      .eq('category', 'visitor')
      .lt('created_at', monthsAgo(14)), fallite);

    // 27/8/2026 (R059) — LE RIGHE DI ACCESSO NON SE NE ANDAVANO MAI.
    //
    // Qui si cancellava solo la categoria `visitor`, cioe' la navigazione. Gli
    // eventi di accesso — entrata, uscita, registrazione, categoria `auth` —
    // restavano per sempre: chi sei, da che apparecchio, con che programma, in
    // che giorno e a che ora. Un archivio di accessi che cresce senza fine e'
    // anche il bottino peggiore da lasciare in mano a un intruso.
    //
    // La finestra e' la stessa che dichiariamo per i log di accesso: 12 mesi.
    await pota('activity_events.accessi', admin
      .from('activity_events')
      .delete()
      .eq('category', 'auth')
      .lt('created_at', monthsAgo(12)), fallite);

    // I messaggi dal modulo contatti oltre due anni non servono piu' a nessuno.
    await pota('contact_messages', admin
      .from('contact_messages')
      .delete()
      .lt('created_at', monthsAgo(24)), fallite);

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

    // 3/9/2026 — IL BUONO REGALO TENEVA PER SEMPRE L'EMAIL DI CHI NON E' NOSTRO
    // CLIENTE.
    //
    // I dati del destinatario di un buono regalo servono a recapitare il
    // regalo. Finito quello — buono speso o scaduto da piu' di 12 mesi — non
    // servono a niente, e appartengono a una persona che con noi non ha nessun
    // rapporto: non ha un account, non ha comprato, spesso non sa nemmeno che
    // esistiamo. Finche' questa potatura non c'era, il suo nome e la sua email
    // se ne andavano solo se CHI HA COMPRATO il buono (o chi lo ha riscattato)
    // chiedeva di cancellare il proprio account: cioe' quasi mai.
    //
    // Il credito e il codice restano: si tolgono solo nome, email e messaggio —
    // il messaggio e' il testo privato che una persona ha scritto a un'altra.
    // Il filtro `recipient_email is not null` rende la pulizia idempotente:
    // ripassarci sopra ogni notte non riscrive righe gia' pulite.
    await pota('gift_cards', admin
      .from('gift_cards')
      .update({ recipient_name: null, recipient_email: null, message: null })
      .lt('expires_at', monthsAgo(12))
      .not('recipient_email', 'is', null), fallite);
    await pota('gift_cards_esauriti', admin
      .from('gift_cards')
      .update({ recipient_name: null, recipient_email: null, message: null })
      .eq('balance_cents', 0)
      .lt('redeemed_at', monthsAgo(12))
      .not('recipient_email', 'is', null), fallite);
  } catch (e) {
    logger.warn('[cron-deletions] prune retention IP/UA parziale', { e });
  }

  // Chiama la function SQL che ritorna gli userId scaduti
  const { data: expired, error: rpcErr } = await admin.rpc('process_expired_deletions');
  if (rpcErr) {
    logger.error('[cron-deletions] RPC failed', rpcErr);
    return ApiErrors.internal(rpcErr.message);
  }

  const scadute = (expired ?? []) as Array<{ user_id: string; deleted_at: string | null }>;
  const userIds: string[] = scadute.map((r) => r.user_id);
  if (userIds.length === 0) {
    return NextResponse.json({ processed: 0, message: 'No accounts to process', retentionFallite: fallite.n });
  }

  const results = { ok: 0, errors: [] as string[] };
  const tentativi: TentativoCancellazione[] = [];

  for (const riga of scadute) {
    const userId = riga.user_id;
    // #178 — La stessa pipeline che usa la cancellazione fatta
    // dall'amministratore: anonimizza il profilo e i dati di verifica
    // identita', anonimizza il testo libero, toglie dalla newsletter, cancella
    // i file dallo storage e infine l'account. Prima erano due elenchi di passi
    // scritti in due file, e uno dei due era piu' corto.
    const esito = await cancellaAccount(admin, userId);
    tentativi.push({
      userId,
      ok: esito.ok,
      motivo: esito.motivo,
      errore: esito.errore,
      // La RPC restituisce anche il giorno in cui la persona ha chiesto di
      // sparire: e' l'unica cosa che dice da quanto sta aspettando, e quindi
      // l'unica che distingue un rinvio di ieri da un termine di legge scaduto.
      chiestaIl: riga.deleted_at,
    });
    if (!esito.ok) {
      logger.error('[cron-deletions] cancellazione fallita', {
        userId, errore: esito.errore, motivo: esito.motivo ?? null,
      });
      results.errors.push(`${userId}: ${esito.errore ?? 'errore'}`);
      continue;
    }

    results.ok++;
    logger.info('[cron-deletions] processed', { userId, fileRimossi: esito.fileRimossi });
  }

  const verdetto = verdettoDelGiro(tentativi, Date.now());
  if (verdetto.daSvegliare) await sveglia(admin, verdetto);

  return NextResponse.json(
    {
      processed: results.ok,
      // 3/9/2026 — `failed` conta SOLO i guasti. Prima contava ogni «non
      // cancellato», rinvii compresi: chi leggeva la risposta vedeva un
      // fallimento dove c'era una regola che stava funzionando.
      failed: verdetto.fallite,
      errors: results.errors,
      total: userIds.length,
      // R169 — Quante pulizie di ritenzione non sono riuscite: senza questo numero
      // il lavoro rispondeva «fatto» anche quando non aveva pulito niente.
      retentionFallite: fallite.n,
      // 3/9/2026 — Un rinvio deciso da noi non e' un fallimento, ma non e'
      // nemmeno un successo: se non ha un posto suo nella risposta, sparisce
      // dentro `failed` (e allora l'allarme suona ogni notte) oppure dentro
      // `processed` (e allora non suona mai).
      rinviate: verdetto.rinviate,
      scadute: verdetto.scadute,
    },
    // 3/9/2026 — LA NOTTE CHE FALLISCE FINISCE ROSSA.
    //
    // Qui si rispondeva 200 con `failed: 3` nel corpo, e il corpo non lo legge
    // nessuno: ne' Vercel, che guarda il codice di stato, ne' il freno
    // anti-silenzio, che scrive il battito solo se la risposta e' buona
    // (`withCronAuth`). Un 500 fa due cose insieme: rende rossa l'esecuzione
    // nel pannello dei lavori periodici, e NON scrive il battito — cosi' se la
    // cosa va avanti anche il sorvegliante se ne accorge da solo.
    { status: verdetto.daSvegliare ? 500 : 200 },
  );
});

/**
 * Sveglia un amministratore. Best-effort di proposito: se la notifica non
 * riesce, la notte resta rossa lo stesso (il 500 qui sopra non dipende da
 * questa funzione) — un allarme che non parte non deve poter cancellare il
 * guasto che doveva annunciare.
 *
 * Perche' la notifica in-app e non l'email: la posta ce l'ha gia' in mano il
 * sorvegliante (`operational-alerts`), che manda un messaggio solo ogni sei ore
 * per la stessa cosa. Qui si scrive nel pannello, che e' il posto dove un
 * amministratore guarda comunque, e nel registro degli errori, che arriva a
 * Sentry.
 */
async function sveglia(admin: Admin, verdetto: VerdettoGiro): Promise<void> {
  logger.error('[cron-deletions] richieste di cancellazione non eseguite', {
    fallite: verdetto.fallite,
    scadute: verdetto.scadute,
    riga: verdetto.riga,
  });
  try {
    const { data: amministratori } = await admin
      .from('profiles').select('id').eq('role', 'admin').limit(10);
    if (!amministratori || amministratori.length === 0) {
      logger.error('[cron-deletions] nessun amministratore a cui dirlo: allarme non recapitato');
      return;
    }
    const { error } = await admin.from('notifications').insert(
      (amministratori as { id: string }[]).map((a) => ({
        user_id: a.id,
        // Categoria di sistema: non e' una promozione e non si spegne con gli
        // interruttori del marketing (#33).
        category: 'system',
        title: 'Cancellazioni account non eseguite',
        body: verdetto.riga ?? 'Il giro notturno delle cancellazioni non e andato a buon fine.',
        link: '/admin/users',
      })),
    );
    if (error) {
      logger.error('[cron-deletions] avviso agli amministratori non scritto', { message: error.message });
    }
  } catch (e) {
    logger.error('[cron-deletions] avviso agli amministratori non partito', { e });
  }
}

// I lavori periodici di Vercel bussano in GET, sempre — non c'è modo di
// chiedergli un POST. Questa rotta nasceva POST-e-basta, dai tempi del cron
// esterno: su Vercel avrebbe risposto «405 metodo non ammesso» a ogni giro, e
// il lavoro non sarebbe mai partito. Stesso identico handler, stesso controllo
// del segreto: cambia solo la porta da cui si entra. Il POST resta valido
// perché il cron esterno continua a girare finché non lo spegni.
export const GET = POST;

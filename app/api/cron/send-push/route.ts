import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { chiamataDelCalendarioFerma, rispostaDelFermo, segnaGiroNonFatto } from '@/lib/cron/fermo-dei-lavori';
import { ApiErrors } from '@/lib/api/responses';
import { isPushConfigured, iscrizioniPerUtenti, sendPushToUser } from '@/lib/push/send';
import { CONSEGNA_PER_CATEGORIA, contrassegno } from '@/lib/push/subito';

// 20/11/2026 — Quanto vale un avviso (`CONSEGNA_PER_CATEGORIA`) e quale sostituisce sul
// telefono (`contrassegno`) stanno in lib/push/subito.ts: le usa anche l'aiutante per l'invio subito
// della push del nuovo ordine (`mandaSubitoLaPushDelNuovoOrdine`), che oggi nessuna rotta chiama
// ancora (vedi sotto), e devono restare uguali.

/** Le categorie che possono aspettare: senza la preferenza letta non partono. */
const CATEGORIE_CHE_ASPETTANO = new Set(['promo', 'group', 'newsletter']);

/**
 * Cron: invia le web push per le notifiche non ancora inviate (pushed_at NULL)
 * create nell'ultima ora. Ogni notifica viene processata una sola volta: il giro
 * la PRENDE prima di mandarla (pushed_at da vuoto all'ora della presa, in una
 * scrittura condizionata) e la ridà al giro dopo solo se l'invio non è andato.
 * Le subscription morte (404/410) vengono rimosse dal sender.
 *
 * Cadenza: ogni 5 minuti. Chi la fa partire sta in `vercel.json` → `crons`.
 * Oggi il nuovo ordine aspetta questo giro: la push al negozio la manda solo lui, quindi può
 * arrivare fino a 5 minuti dopo l'ordine. L'aiutante per mandarla subito alla creazione
 * dell'ordine esiste (`mandaSubitoLaPushDelNuovoOrdine`, lib/push/subito.ts), ma nessuna rotta
 * lo chiama ancora: quando lo farà, segnerà `pushed_at` e qui la push non tornerà; questo giro
 * resterà la rete di sicurezza per quelle che l'invio subito non è riuscito a mandare.
 * A mano si chiama così:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yoursite/api/cron/send-push
 */
export const runtime = 'nodejs';

const handler = withCronAuth(async (req): Promise<NextResponse> => {
  // 31/10/2026 — Il fermo dei lavori a orario: dopo il segreto, prima di tutto il resto (lib/cron/fermo-dei-lavori.ts).
  if (chiamataDelCalendarioFerma(req)) return rispostaDelFermo();
  // Se le chiavi VAPID non sono configurate, non tocchiamo le notifiche
  // (così quando verranno configurate, l'arretrato recente verrà comunque inviato).
  if (!isPushConfigured()) {
    // R28-006 — Senza chiavi il giro non manda niente: non è un battito. «Giro non avvenuto» (come il fermo),
    // così withCronAuth non lo scrive e il semaforo non mostra vivo un lavoro che non lavora.
    return segnaGiroNonFatto(NextResponse.json({ ok: true, skipped: 'VAPID non configurato', sent: 0 }), 'fermo');
  }

  // 27/8/2026 (R009) — IL CLIENT AMMINISTRATIVO SI PRENDE DA UN POSTO SOLO.
  // Qui se ne costruiva uno a mano: cinque copie in giro per il progetto, e
  // ognuna e' un posto in piu' da ricordare il giorno in cui la chiave di
  // servizio va ruotata o vanno cambiate le opzioni del client (per esempio per
  // mettere un tetto di tempo). Dimenticarne una vuol dire una rotta che smette
  // di funzionare in silenzio. `getAdminSupabase()` tiene da parte un client
  // solo (#245: ogni client porta la sua coda di connessioni e i suoi timer).
  let supa;
  try { supa = getAdminSupabase(); } catch (e) {
    return ApiErrors.unavailable(e instanceof Error ? e.message : 'config error');
  }

  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: lette, error: erroreLettura } = await supa
    .from('notifications')
    .select('id, user_id, title, body, link, category')
    .is('pushed_at', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(100);
  // 5/11/2026 — Una lettura caduta non è «niente da mandare»: il giro risponde 503, come send-emails.
  if (erroreLettura) {
    logger.error('[cron] notifiche push non leggibili', { message: erroreLettura.message });
    return ApiErrors.unavailable('notifiche non leggibili');
  }

  let pending = lette;
  if (!pending?.length) return NextResponse.json({ ok: true, sent: 0, processed: 0 });

  // R26-003 — La lettura va dalla più vecchia: se le prime cento sono promozioni, la notifica del nuovo ordine
  // restava fuori dal giro e aspettava il successivo. Se la finestra è piena e dentro ci sono categorie che
  // aspettano, si rilegge solo quello che non aspetta (anche senza categoria, che vale «order») e lo si mette davanti.
  if (pending.length >= 100 && pending.some((n) => CATEGORIE_CHE_ASPETTANO.has((n as { category: string | null }).category ?? ''))) {
    const { data: urgenti, error: erroreUrgenti } = await supa
      .from('notifications')
      .select('id, user_id, title, body, link, category')
      .is('pushed_at', null)
      .gte('created_at', sinceIso)
      .or(`category.is.null,category.not.in.(${[...CATEGORIE_CHE_ASPETTANO].join(',')})`)
      .order('created_at', { ascending: true })
      .limit(100);
    if (erroreUrgenti) {
      logger.warn('[cron] notifiche urgenti non rilette', { message: erroreUrgenti.message });
    } else if (urgenti?.length) {
      const viste = new Set(urgenti.map((n) => n.id));
      pending = [...urgenti, ...pending.filter((n) => !viste.has(n.id))].slice(0, 100);
    }
  }

  /**
   * 28/11/2026 (R03-016 · R03-015 · R08-009) — LA PRESA IN CARICO È ATOMICA.
   *
   * Il giro leggeva le notifiche con `pushed_at` vuoto, mandava le push e solo alla fine scriveva
   * `pushed_at`. Due giri sovrapposti (il ritentativo di Vercel, una chiamata a mano, un giro lento
   * che arriva al successivo: i cron durano fino a 300 secondi, la cadenza è di 5 minuti) leggevano le
   * stesse righe e le mandavano tutte e due: «Nuovo ordine» due volte sul telefono del negozio. Lo
   * stesso con l'invio subito della push del nuovo ordine (lib/push/subito.ts), che prende le righe
   * guardando solo `pushed_at`: il giro le aveva già lette ma non ancora segnate, e partivano due volte.
   *
   * Adesso il giro le PRENDE prima di mandarle, come l'invio subito: una scrittura sola, condizionata
   * (`pushed_at` da vuoto all'ora della presa, solo dove è ancora vuoto). Quello che torna è suo; quelle
   * prese da un altro giro, o dall'invio subito, non tornano. Le notifiche che non partono (invio non
   * riuscito, preferenza o iscrizioni non lette) si ridanno al giro dopo, solo se hanno ancora la sua
   * presa, anche quando qualcosa lancia a metà.
   */
  const presa = new Date().toISOString();
  const { data: prese, error: errorePresa } = await supa
    .from('notifications')
    .update({ pushed_at: presa })
    .in('id', pending.map((n) => n.id))
    .is('pushed_at', null)
    .select('id');
  if (errorePresa) {
    logger.error('[cron] notifiche push non prese in carico: il giro dopo riprova', { message: errorePresa.message });
    return ApiErrors.unavailable('notifiche non prese in carico');
  }
  const preseDaQui = new Set(((prese ?? []) as { id: string }[]).map((r) => r.id));
  const giaPrese = pending.length - preseDaQui.size;
  pending = pending.filter((n) => preseDaQui.has(n.id));
  if (pending.length === 0) return NextResponse.json({ ok: true, sent: 0, processed: 0, giaPrese });

  /**
   * 22/8/2026 — TRE VIAGGI AL DATABASE PER OGNI SINGOLA NOTIFICA.
   *
   * Il ciclo faceva tutto in fila: per ognuna delle cento notifiche una lettura
   * delle preferenze, una lettura delle iscrizioni push dentro `sendPushToUser`,
   * e una scrittura. Trecento viaggi in sequenza, ognuno con la sua attesa di
   * rete. Il giro dura minuti, e le notifiche che dovrebbero dire «il tuo
   * ordine e' pronto» arrivano quando non servono piu'.
   *
   * Adesso: le preferenze si leggono una volta per PERSONA (le cento notifiche
   * sono di molte meno persone), gli invii vanno a gruppi di dieci in
   * parallelo, e le notifiche si prendono (sopra) e si ridanno al giro dopo
   * (in fondo) con una scrittura sola ciascuna.
   */
  const notifiche = pending as {
    id: string; user_id: string; title: string; body: string | null;
    link: string | null; category: string | null;
  }[];

  let sent = 0;
  let retried = 0;
  let saltate = 0;
  let rimandate = 0;
  // Le notifiche prese e sistemate (mandate, o scartate per scelta di chi le riceve): restano segnate.
  const daSegnare: string[] = [];
  try {
    // ① Le preferenze, una volta per persona+categoria invece che per notifica.
    const chiavi = new Map<string, { user: string; categoria: string }>();
    for (const n of notifiche) {
      const categoria = n.category ?? 'order';
      chiavi.set(`${n.user_id}|${categoria}`, { user: n.user_id, categoria });
    }
    const vuoleDavvero = new Map<string, boolean>();
    const nonLette = new Set<string>();
    /**
     * 30/8/2026 (R076) — QUESTE ANDAVANO A GRUPPI DI CENTO, CIOE' SENZA TETTO.
     *
     * Il `Promise.all` qui sopra apriva una domanda per ogni coppia
     * persona+categoria tutte nello stesso istante: col batch pieno sono cento
     * chiamate contemporanee al gestore di connessioni di Supabase. Il tetto a
     * gruppi di dieci esisteva gia', ma solo piu' sotto, per gli invii. Il
     * momento in cui il batch e' pieno e' il picco degli ordini — lo stesso in
     * cui sul database ci sono i clienti veri che navigano.
     */
    const GRUPPO = 10;
    const daChiedere = [...chiavi.entries()];
    for (let i = 0; i < daChiedere.length; i += GRUPPO) {
      await Promise.all(
        daChiedere.slice(i, i + GRUPPO).map(async ([chiave, v]) => {
          const { data, error } = await supa.rpc('vuole_notifica', { p_user_id: v.user, p_category: v.categoria });
          // 5/11/2026 — Preferenza non letta: le categorie che possono aspettare restano in coda
          // (tornano al giro dopo, vedi ④); ordini e avvisi di servizio partono.
          if (error) {
            logger.warn('[cron] preferenza push non letta', { categoria: v.categoria, message: error.message });
            if (CATEGORIE_CHE_ASPETTANO.has(v.categoria)) {
              nonLette.add(chiave);
              return;
            }
          }
          vuoleDavvero.set(chiave, data !== false);
        }),
      );
    }

    const daMandare = notifiche.filter((n) => {
      const chiave = `${n.user_id}|${n.category ?? 'order'}`;
      if (nonLette.has(chiave)) {
        rimandate++;
        return false;
      }
      if (vuoleDavvero.get(chiave) === false) {
        // Segnata come gestita: non e' un errore, e' una scelta di chi la riceve.
        daSegnare.push(n.id);
        saltate++;
        return false;
      }
      return true;
    });

    /**
     * ② Le iscrizioni push: UNA lettura per tutti, non una per notifica.
     *
     * 30/8/2026 (R076) — `sendPushToUser` se le rileggeva da sola ogni volta, e
     * qui la si chiama una volta per notifica: col batch pieno erano cento
     * letture della stessa tabella dove ne basta una. Il commento in cima
     * dichiarava risolte le PREFERENZE, non le iscrizioni: quelle erano rimaste.
     */
    // 5/11/2026 — Se la lettura delle iscrizioni cade non si manda e non si segna niente: riprova il
    // giro dopo. Prima la mappa vuota diceva «nessuno iscritto» e il lotto risultava mandato.
    let iscrizioni: Awaited<ReturnType<typeof iscrizioniPerUtenti>>;
    try {
      iscrizioni = await iscrizioniPerUtenti(supa, [...new Set(daMandare.map((n) => n.user_id))]);
    } catch (e) {
      logger.error('[cron] iscrizioni push non lette: il giro dopo riprova', { message: e instanceof Error ? e.message : String(e) });
      rimandate += daMandare.length;
      daMandare.length = 0;
      iscrizioni = new Map();
    }

    // ③ Gli invii, a gruppi di dieci in parallelo invece che uno per volta.
    for (let i = 0; i < daMandare.length; i += GRUPPO) {
      const gruppo = daMandare.slice(i, i + GRUPPO);
      const esiti = await Promise.allSettled(
        gruppo.map((n) =>
          sendPushToUser(supa, n.user_id, {
            title: n.title,
            body: n.body ?? undefined,
            url: n.link ?? '/',
            tag: contrassegno(n),
            renotify: true,
          }, iscrizioni.get(n.user_id) ?? [], CONSEGNA_PER_CATEGORIA[n.category ?? 'order']),
        ),
      );
      esiti.forEach((esito, k) => {
        if (esito.status !== 'fulfilled') {
          retried++;
          return;
        }
        const r = esito.value;
        sent += r.delivered;
        // 🟠-10: si segna SOLO se almeno una push e' arrivata, o se non c'era
        // niente da consegnare. Se c'erano iscrizioni e zero consegne e' un
        // guasto passeggero: si ritenta al giro dopo.
        if (r.delivered > 0 || r.total === 0) daSegnare.push(gruppo[k].id);
        else retried++;
      });
    }
  } finally {
    // ④ Quelle gestite hanno già la presa come segno. Le altre (non partite, o rimaste a metà se
    // qualcosa ha lanciato) tornano al giro dopo con una scrittura sola, solo se la presa è ancora
    // la nostra: una riga segnata nel frattempo da qualcun altro non si tocca.
    const gestite = new Set(daSegnare);
    const daRidare = notifiche.map((n) => n.id).filter((id) => !gestite.has(id));
    if (daRidare.length > 0) {
      let errore: string | null = null;
      try {
        const { error } = await supa
          .from('notifications')
          .update({ pushed_at: null })
          .in('id', daRidare)
          .eq('pushed_at', presa);
        if (error) errore = error.message;
      } catch (e) {
        errore = e instanceof Error ? e.message : String(e);
      }
      if (errore) {
        logger.error('[cron] push non mandate e non ridate al giro: restano prese e non partono più', {
          quante: daRidare.length, message: errore,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, sent, processed: pending.length, retried, saltate, rimandate, giaPrese });
});

export const GET = handler;
export const POST = handler;

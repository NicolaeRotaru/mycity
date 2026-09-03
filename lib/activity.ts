import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * Helper server-side per scrivere righe in `activity_events` — il firehose di
 * sorveglianza dell'admin. Best-effort come lib/audit.ts: non blocca mai la
 * richiesta se il log fallisce.
 *
 * I cambiamenti dati (insert/update/delete sulle tabelle) sono catturati dai
 * trigger DB (migration 073). Questo helper serve per gli eventi applicativi che
 * non passano dal DB: page view dei visitatori, login/logout, e il mirror delle
 * azioni admin (lib/audit.ts).
 */

export type ActivityCategory =
  | 'visitor'
  | 'auth'
  | 'commerce'
  | 'catalog'
  | 'content'
  | 'user'
  | 'moderation'
  | 'system';

export type ActivityEntry = {
  category: ActivityCategory;
  eventType: string;
  summary?: string;
  actorId?: string | null;
  userId?: string | null;
  anonId?: string | null;
  sessionId?: string | null;
  targetTable?: string | null;
  targetId?: string | null;
  path?: string | null;
  referrer?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  deviceType?: string | null;
  browser?: string | null;
  os?: string | null;
  country?: string | null;
  city?: string | null;
  isBot?: boolean;
  metadata?: Record<string, unknown> | null;
};

/**
 * 3/9/2026 — DIECI VOLTE LO STESSO GUASTO, E NESSUNO CHE LO VEDESSE.
 *
 * Dal 18/8 al 2/9 questa funzione è caduta dieci volte su dieci con lo stesso
 * errore: «Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY)».
 * La chiave di servizio non è mai stata messa fra le variabili di produzione.
 * Ogni visita, ogni accesso, ogni clic provava a scrivere, falliva, e finiva in
 * un `console.error` che non sveglia nessuno: le viste prodotto e l'«attività
 * dal vivo» restavano a zero anche col traffico vero, e sembrava solo che non
 * passasse nessuno.
 *
 * Due cose sbagliate, non una:
 *
 * ① IL GUASTO NON SI VEDEVA. `console.error` in produzione non arriva a Sentry:
 *    resta in un registro che si guarda solo se già si sospetta qualcosa. Ora la
 *    prima caduta passa da `logger.error`, che finisce dove gli errori si
 *    guardano davvero, e dice cosa manca e cosa smette di funzionare.
 *
 * ② SI RITENTAVA ALL'INFINITO. Una variabile d'ambiente assente non ricompare
 *    da sola: il processo va ripubblicato. Riprovare a ogni beacon significa
 *    solo moltiplicare lo stesso errore. Ora, sul guasto di CONFIGURAZIONE, la
 *    registrazione si spegne e non ritenta più — un allarme solo, forte, invece
 *    di dieci uguali.
 *
 * Un guasto di scrittura passeggero (database irraggiungibile per un attimo) NON
 * spegne niente: quello sì che si risolve da solo, e va ritentato.
 */
type StatoRegistrazione = {
  /** Vero quando la registrazione è spenta perché manca la configurazione. */
  spenta: boolean;
  /** Cosa manca, in chiaro. `null` finché va tutto bene. */
  motivo: string | null;
  /** Quando si è spenta. */
  dalle: string | null;
  /** Quante scritture sono state buttate via da quando è spenta. */
  scartate: number;
};

const stato: StatoRegistrazione = { spenta: false, motivo: null, dalle: null, scartate: 0 };

/**
 * Come si riconosce il guasto di configurazione senza indovinare: sono le due
 * frasi esatte che lancia `lib/env.ts`. Stretto apposta — se qui passasse un
 * guasto passeggero, la registrazione si spegnerebbe per un attimo di rete e
 * resterebbe spenta fino alla ripubblicazione.
 */
const SEGNO_DI_CONFIGURAZIONE_MANCANTE =
  /SUPABASE_SERVICE_ROLE_KEY|Service role Supabase non configurato|Variabili Supabase mancanti/i;

/** Postgres: riga già presente. Con un vincolo di unicità è un successo, non un errore. */
const RIGA_GIA_PRESENTE = '23505';

function eGuastoDiConfigurazione(err: unknown): boolean {
  const testo = err instanceof Error ? err.message : String(err ?? '');
  return SEGNO_DI_CONFIGURAZIONE_MANCANTE.test(testo);
}

/**
 * Come sta la registrazione dell'attività. La leggono le prove e chiunque debba
 * mostrare a un umano che il registro è fermo (invece di far credere che il
 * sito sia deserto).
 */
export function statoDellaRegistrazione(): Readonly<StatoRegistrazione> {
  return { ...stato };
}

/** Solo per le prove: rimette in piedi la registrazione fra un caso e l'altro. */
export function __riaccendiRegistrazione(): void {
  stato.spenta = false;
  stato.motivo = null;
  stato.dalle = null;
  stato.scartate = 0;
}

function spegni(err: unknown): void {
  stato.spenta = true;
  stato.motivo = err instanceof Error ? err.message : String(err ?? 'motivo sconosciuto');
  stato.dalle = new Date().toISOString();
  logger.error(
    new Error(
      `Registrazione attività spenta: la configurazione di Supabase non c'è (${stato.motivo}). ` +
        'Da adesso accessi, pagine viste e attività dal vivo non vengono più salvati, e non si ritenta ' +
        'finché la variabile non torna: va messa fra le variabili di produzione (SUPABASE_SERVICE_ROLE_KEY) ' +
        'e il sito va ripubblicato.',
    ),
    { contesto: 'activity-record' },
  );
}

export async function recordActivity(entry: ActivityEntry): Promise<void> {
  // Spenta per configurazione mancante: non si ritenta, si conta e basta.
  if (stato.spenta) {
    stato.scartate++;
    return;
  }
  try {
    const supa = getAdminSupabase();
    const esito = await supa.from('activity_events').insert({
      category: entry.category,
      event_type: entry.eventType,
      summary: entry.summary ?? null,
      actor_id: entry.actorId ?? null,
      user_id: entry.userId ?? null,
      anon_id: entry.anonId ?? null,
      session_id: entry.sessionId ?? null,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId ?? null,
      path: entry.path ?? null,
      referrer: entry.referrer ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
      device_type: entry.deviceType ?? null,
      browser: entry.browser ?? null,
      os: entry.os ?? null,
      country: entry.country ?? null,
      city: entry.city ?? null,
      is_bot: entry.isBot ?? false,
      metadata: entry.metadata ?? null,
    });
    // Con il vincolo di unicità sull'accesso (vedi `accessoGiaRegistrato`) il
    // doppione non è un guasto: è la seconda copia dello stesso fatto, e va
    // scartata in silenzio.
    const error = (esito as { error?: { code?: string; message?: string } | null } | null)?.error;
    if (error && error.code !== RIGA_GIA_PRESENTE) {
      logger.warn('[activity] scrittura rifiutata dal database', { errore: error.message });
    }
  } catch (err) {
    if (eGuastoDiConfigurazione(err)) {
      spegni(err);
      return;
    }
    // Guasto passeggero: si segnala e si continuerà a ritentare.
    logger.warn('[activity] scrittura non riuscita', { err });
  }
}

/**
 * 3/9/2026 — L'ACCESSO ARRIVA DA DUE STRADE, E LA RIGA DEVE RESTARE UNA.
 *
 * Chi entra con email e password fa partire due segnali quasi insieme: quello
 * del catalogo eventi (`trackSignedIn`) e quello che il tracker manda quando
 * vede cambiare la sessione. Due segnali per un fatto solo: nel registro degli
 * accessi resterebbero due righe, e chi conta gli accessi conterebbe doppio.
 *
 * La regola, e le due cose che deve tenere insieme:
 *
 * ① STESSA SESSIONE DEL BROWSER, poco fa → è la seconda copia dello stesso
 *    accesso: si scarta. La finestra larga serve perché i due segnali possono
 *    arrivare a qualche secondo di distanza; oltre la mezz'ora, nella stessa
 *    scheda, è un accesso nuovo davvero e va scritto.
 * ② SESSIONE DIVERSA → è un accesso diverso: si scrive SEMPRE, anche se è
 *    arrivato un istante dopo. Un accesso da un altro telefono un minuto dopo il
 *    tuo è esattamente il fatto da guardare quando un account viene rubato:
 *    nasconderlo per non contare doppio sarebbe il danno peggiore dei due.
 * ③ Quando la sessione non si sa (il browser non la sa tenere) resta solo il
 *    tempo: due copie dello stesso accesso arrivano nel giro di millisecondi,
 *    quindi un minuto basta e avanza.
 *
 * ⚠️ Questo è il controllo dell'applicazione: fra la lettura e la scrittura c'è
 * una fessura di millisecondi. Il freno vero è un vincolo di unicità sul
 * database — è nella migrazione proposta, e finché non c'è questo regge il
 * caso normale.
 */
/** Due copie dello stesso accesso, quando la sessione del browser non si sa. */
export const FINESTRA_ACCESSO_DOPPIO_MS = 60_000;
/** Nella stessa scheda del browser, oltre questa distanza è un accesso nuovo. */
export const FINESTRA_STESSA_SESSIONE_MS = 30 * 60_000;
/** Quanti accessi recenti si guardano: i due segnali possono essersi incrociati. */
const ACCESSI_RECENTI_DA_GUARDARE = 5;

export async function accessoGiaRegistrato(
  userId: string,
  sessionId: string | null,
  adesso: Date = new Date(),
): Promise<boolean> {
  if (stato.spenta) return false; // non si sa: la scrittura verrà scartata comunque
  try {
    const supa = getAdminSupabase();
    const { data, error } = await supa
      .from('activity_events')
      .select('created_at, session_id')
      .eq('user_id', userId)
      .eq('event_type', 'login')
      .order('created_at', { ascending: false })
      .limit(ACCESSI_RECENTI_DA_GUARDARE);
    if (error || !data || data.length === 0) return false;
    for (const riga of data as Array<{ created_at: string | null; session_id: string | null }>) {
      const quando = riga.created_at ? Date.parse(riga.created_at) : NaN;
      if (!Number.isFinite(quando)) continue;
      const da = adesso.getTime() - quando;
      if (sessionId && riga.session_id) {
        if (riga.session_id === sessionId && da < FINESTRA_STESSA_SESSIONE_MS) return true;
        continue; // sessione diversa: è un altro accesso, non un doppione
      }
      if (da < FINESTRA_ACCESSO_DOPPIO_MS) return true;
    }
    return false;
  } catch (err) {
    if (eGuastoDiConfigurazione(err)) {
      spegni(err);
      return false;
    }
    // Se non si riesce a controllare, meglio una riga in più che un accesso
    // perso: il registro serve a guardare chi è entrato.
    return false;
  }
}

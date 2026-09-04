import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { segretiCombaciano, gettoneBearer } from '@/lib/api/segreti';
import {
  esitoBattiti,
  battitiNonLetti,
  SOGLIE_VISTE_DA_FUORI,
  type CronHeartbeat,
  type EsitoBattiti,
} from '@/lib/cron-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * «È pronto a servire?» — la domanda che include il database.
 *
 * 22/8/2026 — PERCHÉ QUESTA ROTTA È SEPARATA DA /api/health.
 *
 * Quella la interroga l'hosting per decidere se ammazzare il processo. Se ci si
 * mette dentro il database, un database lento fa riavviare istanze sane: si
 * perdono le richieste in corso, il processo riparte, ritrova lo stesso
 * database lento, riparte di nuovo. Un rallentamento diventa un blackout, per
 * mano nostra.
 *
 * Qui invece ci può stare, perché questa rotta la guarda un monitor esterno:
 * avvisa una persona, non riavvia niente. È la stessa distinzione che fanno i
 * sistemi di orchestrazione fra «vivo» e «pronto», e serve esattamente a questo.
 *
 * 27/8/2026 (R186) — ERA RIMASTA INDIETRO RISPETTO AL SUO GEMELLO. Su
 * /api/health le due difese sono state messe e spiegate; qui no. Chiunque
 * poteva leggere il messaggio d'errore grezzo di Postgres — che è una mappa di
 * dov'è scoperto il sito — e far girare una query vera sul database di
 * produzione a raffica da un indirizzo solo, consumando connessioni proprio
 * quando il database è già in difficoltà: è la rotta che si interroga quando
 * le cose vanno male. Adesso qui ci sono le stesse due difese del gemello.
 *
 * 31/8/2026 (R183, terzo giro) — ED ERA RIMASTA INDIETRO UN'ALTRA VOLTA, SUI
 * BATTITI DEI LAVORI PERIODICI.
 *
 * Il giro precedente ha aperto /api/health al monitor anonimo: con i cron fermi
 * quella porta risponde `degraded` e nomina i lavori. Qui no. Misurato con
 * tutti e dieci i lavori fermi da dieci giorni, in produzione e senza
 * intestazione di autorizzazione — cioè come chiama il monitor vero: questa
 * rotta rispondeva 200 {"status":"ready"} e dei battiti non sapeva niente. È la
 * porta più autorevole delle due (l'altra si limita a dire se il processo è
 * vivo) ed era la più cieca: due porte dello stesso sito raccontavano due
 * verità diverse, e chi guardava quella giusta non vedeva niente.
 *
 * ── PERCHÉ UN CRON FERMO NON TOGLIE LA PRONTEZZA ──
 * `status` continua a dipendere SOLO dal database, e 503 resta riservato a
 * «questo sito non riesce a servire una pagina». Un lavoro periodico fermo non
 * è quello: le pagine si aprono, i clienti comprano, i pagamenti passano. Se
 * `not_ready` scattasse per un cron indietro, chiunque consumi questa risposta
 * per decidere dove mandare il traffico smetterebbe di mandarne a un sito
 * sano — un cron fermo diventerebbe un sito spento, per mano nostra, che è
 * peggio del male che volevamo segnalare. E chi viene svegliato di notte da un
 * `not_ready` cerca un sito caduto, non un lavoro da far ripartire domattina.
 * Quindi i battiti compaiono come AVVISO dentro una risposta 200: `cron` col
 * verdetto e `degraded: true` accanto.
 *
 * ── PERCHÉ PROPRIO LA PAROLA `degraded` ──
 * È quella che stampa già il gemello. Un monitor esterno si configura con una
 * regola sola sulla parola chiave e copre tutte e due le porte; due parole
 * diverse avrebbero voluto dire due regole, e la seconda non la mette nessuno.
 *
 * ── COSA ESCE A UNO SCONOSCIUTO ──
 * Nome del lavoro e minuti di ritardo: è un dato operativo, ed è l'unica cosa
 * che rende utile guardare questo semaforo senza avere la chiave. Il messaggio
 * grezzo del database resta in `dettaglio`, per chi il segreto ce l'ha: quello
 * sì che è una mappa di dov'è scoperto il sito.
 */
const TETTO_MS = 3000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Come sul gemello: le sonde interne non mandano `x-forwarded-for` e non
  // devono finire tutte nello stesso contatore, la soglia è larga abbastanza
  // che nessun monitor onesto la tocchi, e sopra soglia si risponde 200 con un
  // corpo minimo — l'abuso non costa una query al database, ma non produce
  // nemmeno un falso allarme «sito caduto».
  if (req.headers.get('x-forwarded-for')) {
    const freno = await rateLimitAsync({ key: `health-ready:${getClientIp(req)}`, max: 600, windowMs: 60_000 });
    if (!freno.allowed) {
      return NextResponse.json(
        { status: 'ready', throttled: true, timestamp: new Date().toISOString() },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      );
    }
  }

  const t0 = Date.now();
  let dbOk = false;
  let dettaglio: string | undefined;

  try {
    const admin = getAdminSupabase();
    const query = admin.from('categories').select('id').limit(1);
    const esito = await Promise.race([
      query.then(({ error }) => ({ scaduto: false as const, error })),
      new Promise<{ scaduto: true; error: null }>((r) =>
        setTimeout(() => r({ scaduto: true, error: null }), TETTO_MS)),
    ]);
    if (esito.scaduto) dettaglio = `nessuna risposta entro ${TETTO_MS}ms`;
    else if (esito.error) dettaglio = esito.error.message;
    else dbOk = true;
  } catch (e) {
    dettaglio = e instanceof Error ? e.message : 'errore sconosciuto';
  }

  // I battiti si misurano con lo STESSO metro del gemello — stesse soglie,
  // stesso verdetto, stessa funzione — perché due porte dello stesso sito che
  // rispondono in modo diverso alla stessa domanda non si possono usare per
  // sorvegliare niente: chi le legge non sa a quale credere.
  const attesi = Object.keys(SOGLIE_VISTE_DA_FUORI).length;
  // Se il database non ha risposto, i battiti non li ha letti nessuno: la
  // seconda query non si fa (sarebbe una connessione in più tolta a un
  // database già in affanno, sulla rotta che si interroga proprio allora) e la
  // risposta lo dice invece di far passare «non guardato» per «sano».
  let cron: EsitoBattiti = battitiNonLetti(attesi, 'battiti non letti: il database non risponde');
  // Il messaggio grezzo del database è una mappa di dov'è scoperto il sito:
  // esce solo a chi ha il segreto in mano.
  let dettaglioBattiti: string | undefined;
  if (dbOk) {
    try {
      const admin = getAdminSupabase();
      const { data, error } = await admin.from('cron_heartbeats').select('name, last_run_at');
      if (error) {
        cron = battitiNonLetti(attesi, 'battiti non leggibili');
        dettaglioBattiti = error.message;
      } else {
        cron = esitoBattiti((data ?? []) as CronHeartbeat[], Date.now(), SOGLIE_VISTE_DA_FUORI);
      }
    } catch (e) {
      cron = battitiNonLetti(attesi, 'battiti non leggibili');
      dettaglioBattiti = e instanceof Error ? e.message : 'errore sconosciuto';
    }
  }

  // Il dettaglio lo vede chi ha il segreto dei lavori periodici, non il mondo.
  // Il monitor esterno guarda il codice HTTP, che non cambia: 200 pronto, 503
  // no. Chi vuole sapere PERCHÉ deve dimostrare di essere di casa.
  const segreto = process.env.CRON_SECRET;
  const autorizzato =
    process.env.NODE_ENV !== 'production' ||
    (!!segreto && segretiCombaciano(gettoneBearer(req.headers.get('authorization')), segreto));

  return NextResponse.json(
    {
      status: dbOk ? 'ready' : 'not_ready',
      // L'avviso che non fa cadere la prontezza: 200 sopra, il motivo qui.
      ...(cron.ok ? {} : { degraded: true }),
      cron: autorizzato && dettaglioBattiti ? { ...cron, dettaglio: dettaglioBattiti } : cron,
      ...(autorizzato ? { db: { ok: dbOk, latencyMs: Date.now() - t0, error: dettaglio } } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}

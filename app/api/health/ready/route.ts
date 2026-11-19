import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { segretiCombaciano, gettoneBearer } from '@/lib/api/segreti';
import { sizedImage, trasformazioneFotoSpenta } from '@/lib/image-url';
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
 * `status` dipende dal database e dalle foto (R02-003), e 503 resta riservato a
 * «questo sito non riesce a servire una pagina» o «le foto del sito non si trasformano». Un lavoro periodico fermo non
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
/** Tetto unico del pezzo foto (lettura prodotti + trasformata + originale), dopo il controllo del database. */
const TETTO_FOTO_MS = 2500;

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
  /**
   * 31/10/2026 — «MANCA LA CHIAVE» USCIVA COME «IL DATABASE NON RISPONDE».
   *
   * `getAdminSupabase()` lancia prima di fare qualsiasi domanda quando la
   * chiave di servizio (o l'indirizzo) non e' impostata. Stava dentro lo
   * stesso try della query, quindi il monitor esterno leggeva «il database
   * non risponde»: chi lo riceve apre la pagina di stato di Supabase, la trova
   * verde e perde un'ora col fornitore, mentre bastava copiare una variabile
   * su Vercel. Il database qui non e' nemmeno stato interrogato: lo si dice.
   */
  let configurazioneMancante = false;
  let admin: ReturnType<typeof getAdminSupabase> | null = null;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    configurazioneMancante = true;
    dettaglio = e instanceof Error ? e.message : 'errore sconosciuto';
  }

  if (admin) {
    try {
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
  }

  /**
   * R02-003 — LE FOTO DEL SITO ARRIVANO ANCORA? (stessa domanda del Check 4 di /api/health)
   *
   * Se l'abbonamento Supabase scade, la trasformazione delle foto risponde 403 e la vetrina resta
   * senza foto con tutto il resto verde. Questa è la rotta che guarda il monitor esterno: se le
   * foto non si trasformano risponde come per il database non pronto (503), col motivo nel corpo.
   *
   * SOLO UN «NO» NETTO TOGLIE LA PRONTEZZA, e il «no» è questo: la foto ORIGINALE (`/object/public/`)
   * risponde 2xx e la stessa foto TRASFORMATA (`/render/image/public/`) risponde 4xx (esclusi 408 e
   * 429). Una trasformata 4xx con l'originale che NON risponde 2xx vuol dire che manca quella foto
   * (cancellata dallo Storage, indirizzo sbagliato): è un dato di un prodotto, non un sito caduto, e
   * non fa suonare il monitor. Lo stesso vale per timeout, errore di rete, 5xx, nessuna foto da
   * chiedere o lettura dei prodotti che non va: un controllo che non sa non fa suonare il monitor.
   *
   * TETTO UNICO: lettura prodotti, trasformata e originale stanno sotto lo STESSO tetto di
   * TETTO_FOTO_MS (2,5 s) che parte quando il database ha risposto, e allo scadere si annullano
   * davvero sia la query (`.abortSignal`) sia i fetch (AbortController). Oltre il tetto la rotta
   * resta pronta. Caso peggiore della rotta: database TETTO_MS (3 s) + foto 2,5 s = 5,5 s, contro i
   * 3 s di prima della cura; la lettura dei battiti che segue non ha tetto e c'era già prima.
   */
  let fotoNo: string | undefined;
  if (dbOk && admin) {
    const freno = new AbortController();
    const scaduto = new Promise<'scaduto'>((r) => freno.signal.addEventListener('abort', () => r('scaduto')));
    const timerFoto = setTimeout(() => freno.abort(), TETTO_FOTO_MS);
    const chiedi = async (indirizzo: string) => {
      const risposta = await fetch(indirizzo, { signal: freno.signal, cache: 'no-store' });
      risposta.body?.cancel().catch(() => {});
      return risposta.status;
    };
    const guardaLeFoto = async (): Promise<string | undefined> => {
      const { data } = await admin
        .from('products')
        .select('images')
        .eq('status', 'available')
        .not('images', 'is', null)
        .limit(20)
        .abortSignal(freno.signal);
      const urlFoto = ((data ?? []) as { images?: unknown }[])
        .flatMap((p) => (Array.isArray(p.images) ? p.images : []))
        .find((u): u is string => typeof u === 'string' && u.includes('/storage/v1/object/public/'));
      if (trasformazioneFotoSpenta()) return undefined;
      const trasformata = sizedImage(urlFoto, 'thumb');
      if (!urlFoto || !trasformata.includes('/storage/v1/render/image/')) return undefined;
      const codice = await chiedi(trasformata);
      if (codice < 400 || codice >= 500 || codice === 408 || codice === 429) return undefined;
      // La trasformata dice no: è colpa della trasformazione o di questa foto? Lo dice l'originale.
      const originale = await chiedi(urlFoto);
      if (originale < 200 || originale >= 300) return undefined;
      return `la trasformazione delle foto di Supabase risponde ${codice} mentre l'originale risponde ${originale}: le foto del sito non arrivano`;
    };
    try {
      const esito = await Promise.race([guardaLeFoto(), scaduto]);
      if (esito !== 'scaduto') fotoNo = esito;
    } catch {
      // Una lettura che non va non dice niente sulle foto: il controllo si salta e la rotta resta pronta.
    } finally {
      clearTimeout(timerFoto);
      freno.abort();
    }
  }
  const pronto = dbOk && !fotoNo;

  // I battiti si misurano con lo STESSO metro del gemello — stesse soglie,
  // stesso verdetto, stessa funzione — perché due porte dello stesso sito che
  // rispondono in modo diverso alla stessa domanda non si possono usare per
  // sorvegliare niente: chi le legge non sa a quale credere.
  const attesi = Object.keys(SOGLIE_VISTE_DA_FUORI).length;
  // Se il database non ha risposto, i battiti non li ha letti nessuno: la
  // seconda query non si fa (sarebbe una connessione in più tolta a un
  // database già in affanno, sulla rotta che si interroga proprio allora) e la
  // risposta lo dice invece di far passare «non guardato» per «sano».
  let cron: EsitoBattiti = battitiNonLetti(
    attesi,
    configurazioneMancante
      ? 'battiti non letti: il server non ha la chiave di servizio del database (configurazione), il database non e stato interrogato'
      : 'battiti non letti: il database non risponde',
  );
  // Il messaggio grezzo del database è una mappa di dov'è scoperto il sito:
  // esce solo a chi ha il segreto in mano.
  let dettaglioBattiti: string | undefined;
  if (dbOk && admin) {
    try {
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
  // R23-009 — ripulito come il gettone (vedi withCronAuth): un «a capo» in fondo al segreto non
  // deve chiudere la porta a chi ce l'ha.
  const segreto = process.env.CRON_SECRET?.trim();
  const autorizzato =
    process.env.NODE_ENV !== 'production' ||
    (!!segreto && segretiCombaciano(gettoneBearer(req.headers.get('authorization')), segreto));

  return NextResponse.json(
    {
      status: pronto ? 'ready' : 'not_ready',
      ...(fotoNo ? { foto: { ok: false, error: fotoNo } } : {}),
      // L'avviso che non fa cadere la prontezza: 200 sopra, il motivo qui.
      ...(cron.ok ? {} : { degraded: true }),
      cron: autorizzato && dettaglioBattiti ? { ...cron, dettaglio: dettaglioBattiti } : cron,
      ...(autorizzato ? { db: { ok: dbOk, latencyMs: Date.now() - t0, error: dettaglio } } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: pronto ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}

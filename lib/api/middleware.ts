import type { NextRequest, NextResponse } from 'next/server';
import { type User } from '@supabase/supabase-js';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { logger } from '@/lib/logger';
import { segretiCombaciano } from '@/lib/api/segreti';
import { ApiErrors } from './responses';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { purchaseBlockReason } from '@/lib/shopping-access';

// 22/8/2026 — spostata in lib/api/segreti.ts: i chiamanti sono due, e la
// rotta di stato — che aveva lo stesso bisogno — non potendola importare da
// qui si era riscritta il confronto con `===`.
const secretsMatch = segretiCombaciano;

/**
 * Middleware riusabili per API routes.
 *
 * Esperti consultati:
 * - Backend Engineer: "Auth boilerplate in 25 routes = -200 LOC. Helper aspetta
 *   solo (req, handler) e estrae bearer + auth + role check."
 * - Security Engineer: "Bearer token verification + role check + rate limit
 *   = 3 layer obbligatori per endpoint sensibili."
 */

type Profile = { id: string; role: string; is_approved: boolean };

/**
 * 22/8/2026 — CHI ENTRA COL GETTONE POI PARLAVA AL DATABASE DA SCONOSCIUTO.
 *
 * L'autenticazione accetta due strade: il gettone nell'intestazione
 * `Authorization` (le chiamate del browser) e il cookie di sessione. Ma il
 * client che le rotte usano dopo — `getServerSupabase()` — legge SOLO i
 * cookie. Chi entrava col gettone risultava autenticato al controllo e poi,
 * nella query, era `auth.uid() = NULL`: per le regole per riga uno sconosciuto.
 *
 * Le rotte lo aggiravano usando il client amministrativo, che scavalca le
 * regole per riga del tutto. Funziona, e sposta tutta la difesa dentro il
 * codice della rotta: se una riga di `if` viene dimenticata, sotto non c'è
 * più niente.
 *
 * Adesso chi autentica restituisce anche il client giusto — quello che porta
 * l'identità di chi ha chiamato, comunque sia entrato. L'amministrativo resta
 * per quello che DEVE scavalcarle, e a quel punto è una scelta, non un ripiego.
 */
export type ClientDiChiChiama = ReturnType<typeof creaClientAnonimo>;
type Contesto = {
  user: User;
  profile: Profile;
  req: NextRequest;
  /** Il client che porta l'identità di chi ha chiamato: rispetta le regole per riga. */
  supaUtente: ClientDiChiChiama;
};
type Handler<T> = (ctx: Contesto) => Promise<NextResponse<T>>;
type GenericHandler = (ctx: Contesto) => Promise<NextResponse>;

// 22/8/2026 — una fabbrica sola, condivisa con lib/supabase/auth-server.ts.
// Prima erano due copie con impostazioni diverse, e questa, quando le variabili
// mancavano, restituiva `null` invece di dire quale mancava.
function getSupabaseAuthClient() {
  try {
    return creaClientAnonimo();
  } catch (e) {
    logger.error('[auth] client anonimo non creabile: configurazione incompleta', e);
    return null;
  }
}

async function authenticate(req: NextRequest): Promise<
  | { ok: true; user: User; profile: Profile; supaUtente: ClientDiChiChiama }
  | { ok: false; response: NextResponse }
> {
  // Tentativo 1: Bearer token nell'Authorization header (client fetch)
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;

  let user: User | null = null;
  let supaUtente: ClientDiChiChiama | null = null;

  if (bearer) {
    const supa = getSupabaseAuthClient();
    if (!supa) return { ok: false, response: ApiErrors.unavailable('Auth non configurato') };
    const { data, error } = await supa.auth.getUser(bearer);
    if (!error && data?.user) {
      user = data.user;
      // Il client per le query dopo: porta il gettone, quindi per il database
      // è la persona che ha chiamato e non uno sconosciuto.
      try {
        supaUtente = creaClientAnonimo({ gettone: bearer });
      } catch (e) {
        logger.error('[auth] client per l utente non creabile', e);
        return { ok: false, response: ApiErrors.unavailable('Auth non configurato') };
      }
    }
  } else {
    // Tentativo 2: cookie session (server-side)
    try {
      const { getCurrentUser, getServerSupabase } = await import('@/lib/supabase/server');
      user = await getCurrentUser();
      // Col cookie il client giusto è quello che legge i cookie: porta già la
      // sessione, quindi le regole per riga vedono la persona.
      if (user) supaUtente = (await getServerSupabase()) as unknown as ClientDiChiChiama;
    } catch (e) {
      // 22/8/2026 — questo catch inghiottiva tutto e faceva uscire 401 «devi
      // accedere» anche quando il problema era nostro. Un guasto di
      // configurazione non è una sessione mancante: chi legge 401 riprova ad
      // accedere all'infinito, chi legge 503 sa che deve guardare il server.
      if (e instanceof Error && e.name === 'AuthNonDisponibile') {
        return { ok: false, response: ApiErrors.unavailable('Auth non configurato') };
      }
      logger.error('[auth] modulo server non caricabile', e);
      return { ok: false, response: ApiErrors.unavailable('Auth non configurato') };
    }
  }

  if (!user || !supaUtente) return { ok: false, response: ApiErrors.unauthorized() };

  // Fetch profile via service-role (admin), NON via client anon. Il client anon
  // non porta la sessione utente: con auth.uid()=NULL le policy RLS di `profiles`
  // non espongono la riga di un buyer/rider ordinario (solo i seller approvati
  // sono pubblici), quindi ogni route withAuth* risponderebbe 403 "Profilo non
  // trovato". L'admin bypassa RLS in modo sicuro (server-only). Vedi audit 🔴-1.
  let profile: Profile | null = null;
  try {
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    const { data } = await getAdminSupabase()
      .from('profiles')
      .select('id, role, is_approved')
      .eq('id', user.id)
      .single();
    profile = (data as Profile | null) ?? null;
  } catch {
    return { ok: false, response: ApiErrors.unavailable('Auth non configurato') };
  }
  if (!profile) return { ok: false, response: ApiErrors.forbidden('Profilo non trovato') };

  return { ok: true, user, profile, supaUtente };
}

/** Blocco acquisto per ruolo (admin, rider, …). Null = può acquistare. */
export function assertCanPurchase(profile: Profile): NextResponse | null {
  const reason = purchaseBlockReason(profile.role);
  return reason ? ApiErrors.forbidden(reason) : null;
}

/**
 * Wrapper: richiede auth (qualsiasi role).
 *   export const POST = withAuth(async ({ user, profile }) => {...});
 */
export function withAuth(handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    return handler({ user: auth.user, profile: auth.profile, req, supaUtente: auth.supaUtente });
  };
}

/**
 * Wrapper: richiede auth + rate limit per-user.
 *
 * Esempio:
 *   export const POST = withAuthRateLimit(
 *     { name: 'returns-create', max: 10, windowMs: 60_000 },
 *     async ({ user }) => {...}
 *   );
 *
 * Il rate limit usa user.id come chiave (piu' robusto di IP per utenti
 * autenticati: condivisione IP in NAT/CGNAT non penalizza). Risponde 429
 * con Retry-After se superato.
 */
export type AuthRateLimitOpts = {
  name: string;
  max: number;
  windowMs: number;
};


/**
 * 22/8/2026 — IL FRENO SCATTAVA DOPO L'AUTENTICAZIONE, NON PRIMA.
 *
 * Il freno per utente è quello giusto per chi ha un account: due persone
 * dietro lo stesso indirizzo di rete — un ufficio, la rete di un operatore
 * mobile — non si penalizzano a vicenda.
 *
 * Ma stava DOPO `authenticate()`, che per ogni richiesta fa una chiamata al
 * servizio di autenticazione e una lettura del profilo. Chi bussa senza un
 * gettone valido non arrivava mai al freno: veniva respinto dopo, e ogni
 * tentativo era comunque costato due chiamate. Diecimila tentativi al minuto
 * da un solo indirizzo erano ventimila chiamate, tutte pagate da noi, per
 * respingere sempre la stessa persona.
 *
 * Adesso ci sono due soglie. Una larga per indirizzo di rete, PRIMA di
 * autenticare — abbastanza alta che nessun uso normale la tocchi, abbastanza
 * bassa che una raffica si fermi subito. E quella per utente, dopo, che resta
 * la difesa vera contro l'abuso di chi un account ce l'ha.
 */
const TETTO_PER_RETE = 300;
const FINESTRA_RETE_MS = 60_000;

async function frenoDiRete(req: NextRequest, nome: string): Promise<NextResponse | null> {
  const rl = await rateLimitAsync({
    key: `rete:${nome}:${getClientIp(req)}`,
    max: TETTO_PER_RETE,
    windowMs: FINESTRA_RETE_MS,
  });
  return rl.allowed ? null : ApiErrors.rateLimited(rl.retryAfterSec);
}

export function withAuthRateLimit(opts: AuthRateLimitOpts, handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const frenato = await frenoDiRete(req, opts.name);
    if (frenato) return frenato;
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const rl = await rateLimitAsync({ key: `${opts.name}:${auth.user.id}`, max: opts.max, windowMs: opts.windowMs });
    if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
    return handler({ user: auth.user, profile: auth.profile, req, supaUtente: auth.supaUtente });
  };
}

/**
 * Wrapper: richiede auth + role 'seller' approvato (o admin).
 */
export function withSellerAuth(handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const { profile } = auth;
    if (profile.role !== 'admin' && (profile.role !== 'seller' || !profile.is_approved)) {
      return ApiErrors.forbidden('Solo seller approvati o admin');
    }
    return handler({ user: auth.user, profile: auth.profile, req, supaUtente: auth.supaUtente });
  };
}

/**
 * Wrapper: richiede auth + role 'seller' approvato (o admin) + rate limit.
 */
export function withSellerAuthRateLimit(opts: AuthRateLimitOpts, handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const frenato = await frenoDiRete(req, opts.name);
    if (frenato) return frenato;
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const { profile } = auth;
    if (profile.role !== 'admin' && (profile.role !== 'seller' || !profile.is_approved)) {
      return ApiErrors.forbidden('Solo seller approvati o admin');
    }
    const rl = await rateLimitAsync({ key: `${opts.name}:${auth.user.id}`, max: opts.max, windowMs: opts.windowMs });
    if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
    return handler({ user: auth.user, profile: auth.profile, req, supaUtente: auth.supaUtente });
  };
}

/**
 * Wrapper: richiede auth + role 'admin'.
 */
export function withAdminAuth(handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    if (auth.profile.role !== 'admin') return ApiErrors.forbidden('Solo admin');
    return handler({ user: auth.user, profile: auth.profile, req, supaUtente: auth.supaUtente });
  };
}

/**
 * Wrapper: richiede auth + role 'admin' + rate limit per-user.
 */
export function withAdminAuthRateLimit(opts: AuthRateLimitOpts, handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const frenato = await frenoDiRete(req, opts.name);
    if (frenato) return frenato;
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    if (auth.profile.role !== 'admin') return ApiErrors.forbidden('Solo admin');
    const rl = await rateLimitAsync({ key: `${opts.name}:${auth.user.id}`, max: opts.max, windowMs: opts.windowMs });
    if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
    return handler({ user: auth.user, profile: auth.profile, req, supaUtente: auth.supaUtente });
  };
}

/**
 * Heartbeat best-effort del cron (audit 🟠-25): registra l'ultima esecuzione in
 * cron_heartbeats, così operational-alerts può accorgersi se un cron SMETTE di
 * girare (dead-man's switch). Trasparente per tutti i cron (passano da qui).
 * Tutto in try/catch fire-and-forget: non deve MAI far fallire il cron.
 */
async function recordCronHeartbeat(req: NextRequest): Promise<void> {
  try {
    const name = new URL(req.url).pathname.split('/').filter(Boolean).pop();
    if (!name) return;
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    await getAdminSupabase()
      .from('cron_heartbeats')
      .upsert({ name, last_run_at: new Date().toISOString() }, { onConflict: 'name' });
  } catch (e) {
    // Il battito non deve MAI far fallire il lavoro: il lavoro e' andato, e
    // questa e' solo la sua ricevuta. Ma non deve nemmeno sparire in silenzio —
    // un sensore che muore muto e' peggio di un sensore che non c'e', perche'
    // il sorvegliante annuncera' che il lavoro e' fermo mentre gira benissimo.
    logger.warn('[cron] battito non registrato: il sorvegliante lo vedra come fermo', {
      message: e instanceof Error ? e.message : 'errore',
    });
  }
}

/**
 * Wrapper: richiede CRON_SECRET nell'header Authorization.
 * Per endpoint chiamati da cron esterni (cron-job.org, Vercel cron).
 */
export function withCronAuth(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const expected = process.env.CRON_SECRET;
    if (!expected) return ApiErrors.unavailable('CRON_SECRET non configurato');
    const authHeader = req.headers.get('authorization');
    const bearer = authHeader?.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null;
    if (!secretsMatch(bearer, expected)) return ApiErrors.unauthorized();

    // Il battito si registra DOPO, e solo se il lavoro e' andato a buon fine.
    //
    // Prima veniva scritto subito dopo il controllo del segreto: l'allarme
    // «questo lavoro non gira piu'» restava zitto anche quando il lavoro girava
    // e falliva ogni volta. Cioe' il sensore che doveva accorgersi dei guasti
    // era l'unico che non li vedeva.
    const risposta = await handler(req);
    if (risposta.status < 400) {
      // 27/8/2026 (R181) — IL BATTITO SI ASPETTA, NON SI SPARA.
      //
      // Qui c'era `void recordCronHeartbeat(req)`: lanciato e non atteso. Su
      // Vercel la funzione puo' essere spenta appena ha risposto, quindi quella
      // scrittura poteva morire a meta' o non partire affatto. E il modo in cui
      // falliva era il peggiore per un sensore: il lavoro girava benissimo, il
      // battito non arrivava, e il sorvegliante annunciava che il lavoro era
      // fermo. Allarmi falsi, finche' nessuno li guarda piu'.
      //
      // Aspettarlo costa pochi millisecondi, su un lavoro periodico dove il
      // tempo di risposta non lo guarda nessuno. Gli errori restano innocui:
      // `recordCronHeartbeat` non rilancia, si limita a lamentarsi.
      await recordCronHeartbeat(req); // dead-man's switch (🟠-25)
    }
    return risposta;
  };
}

/**
 * Wrapper: richiede x-internal-secret per endpoint server-to-server (trigger DB,
 * cron interni, edge functions). Non esporre mai a client browser.
 *
 * Usa un segreto DEDICATO `INTERNAL_API_SECRET`, rotabile per conto suo.
 *
 * 020 — Prima, se quel segreto mancava, si ripiegava su `SUPABASE_SERVICE_ROLE_KEY`:
 * la chiave che scavalca ogni regola del database diventava anche la password di
 * una rotta HTTP. Chi la indovinava o la vedeva passare non entrava in una rotta:
 * entrava dappertutto. E un ripiego silenzioso non si accorge nessuno che c'è.
 * Ora, senza segreto dedicato, la rotta risponde 503: non funziona finché non è
 * configurata, che è esattamente il comportamento che si vuole.
 */
export function withInternalAuth(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected) {
      return ApiErrors.unavailable('INTERNAL_API_SECRET non configurato');
    }
    const provided = req.headers.get('x-internal-secret');
    if (!secretsMatch(provided, expected)) {
      return ApiErrors.forbidden();
    }
    return handler(req);
  };
}

// R23-004 (13/11/2026) — Qui c'era `import 'server-only'`: la libreria non e' fra le dipendenze
// del sito e l'import reggeva solo per una scorciatoia interna di Next (e nelle prove andava
// finta a mano). Il modulo resta del server: lo usa solo la pagina /status, che gira sul server.
import { unstable_cache } from 'next/cache';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { checkTitolare } from './titolare-check';
import { logger } from '@/lib/logger';

/**
 * Health-check REALE dei servizi, usato dalla pagina pubblica /status.
 *
 * Prima la pagina mostrava sempre "tutto verde" con uptime inventati: una
 * falsa promessa. Qui invece ogni servizio viene verificato davvero:
 *  - Database / Realtime: ping reale alle REST di Supabase (SELECT 1).
 *  - Autenticazione: endpoint di health di GoTrue (/auth/v1/health).
 *  - Pagamenti: ping read-only a Stripe (balance.retrieve), nessun addebito.
 *  - Email: ping read-only a Resend (GET /domains), nessuna email inviata.
 *  - Push: presenza chiavi VAPID (non c'è servizio esterno da interrogare).
 *
 * I controlli sono time-boxed (un servizio lento non blocca la pagina) e
 * messi in cache 60s con `unstable_cache`: anche su una pagina pubblica gli
 * endpoint esterni vengono interrogati al massimo una volta al minuto.
 */

export type ServiceStatus = 'operational' | 'degraded' | 'outage' | 'unknown';

export type ServiceHealth = {
  id: string;
  name: string;
  description: string;
  status: ServiceStatus;
  /** Latenza misurata del check, in ms; null quando non c'è un ping reale. */
  latencyMs: number | null;
  /** Nota breve (es. "Non configurato", "API non raggiungibile"). */
  detail: string | null;
};

export type SystemHealth = {
  checkedAt: string; // ISO
  overall: ServiceStatus;
  services: ServiceHealth[];
};

const TIMEOUT_MS = 3500; // oltre questa soglia il check è considerato fallito
const SLOW_MS = 1500; // oltre questa latenza il servizio è "rallentato"

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    await withTimeout(fn(), TIMEOUT_MS);
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : 'errore' };
  }
}

function statusFromLatency(ok: boolean, latencyMs: number): ServiceStatus {
  if (!ok) return 'outage';
  return latencyMs > SLOW_MS ? 'degraded' : 'operational';
}

function svc(
  id: string,
  name: string,
  description: string,
  status: ServiceStatus,
  latencyMs: number | null,
  detail: string | null,
): ServiceHealth {
  return { id, name, description, status, latencyMs, detail };
}

/**
 * 12/11/2026 (R06-023) — IL DATABASE SI CONTROLLA COME LO LEGGE IL CATALOGO.
 *
 * Prima si usava il client amministrativo: senza SUPABASE_SERVICE_ROLE_KEY quel
 * client lancia, e la pagina PUBBLICA scriveva «Database: Non disponibile» e
 * «Disservizio in corso» mentre catalogo, schede e mappa del sito leggevano il
 * database senza problemi con la chiave pubblica. Ora la lettura e' la stessa
 * del catalogo: la chiave pubblica e le categorie.
 */
async function checkDb(): Promise<ServiceHealth> {
  if (!env.supabaseUrl() || !env.supabaseAnonKey()) {
    return svc('db', 'Database', 'Supabase Postgres', 'unknown', null, 'Non configurato');
  }
  const r = await timed(async () => {
    const pubblico = creaClientAnonimo();
    const { error } = await pubblico.from('categories').select('id').limit(1);
    if (error) throw new Error(error.message);
  });
  if (!r.ok) logger.warn('[salute] database non raggiungibile', { motivo: r.error ?? 'sconosciuto' });
  return svc(
    'db', 'Database', 'Supabase Postgres',
    statusFromLatency(r.ok, r.latencyMs),
    r.ok ? r.latencyMs : null,
    r.ok ? null : 'Non raggiungibile',
  );
}

async function checkAuth(): Promise<ServiceHealth> {
  const url = env.supabaseUrl();
  const key = env.supabaseAnonKey();
  if (!url || !key) {
    return svc('auth', 'Autenticazione', 'Accesso, registrazione, recupero password', 'unknown', null, 'Non configurato');
  }
  const tentativo = () => timed(async () => {
    // 22/8/2026 — `withTimeout` smette di ASPETTARE, non chiude la chiamata:
    // la richiesta resta appesa a consumare una connessione, e su un servizio
    // lento ne restano appese una per ogni giro del controllo di salute. Il
    // segnale di annullamento la chiude per davvero.
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
  // 12/11/2026 (R06-023) — Due tentativi prima di dire «giù». Un solo sforamento
  // dei 3,5 secondi faceva scrivere «Autenticazione: Non disponibile» a tutti,
  // mentre Supabase in quello stesso minuto rispondeva 200: se il secondo
  // tentativo risponde, l'accesso e' «rallentato», non fuori servizio.
  const primo = await tentativo();
  const secondo = primo.ok ? null : await tentativo();
  const r = secondo ?? primo;
  if (!r.ok) logger.warn('[salute] accesso non raggiungibile due volte', { motivo: r.error ?? 'sconosciuto' });
  return svc(
    'auth', 'Autenticazione', 'Accesso, registrazione, recupero password',
    !r.ok ? 'outage' : secondo ? 'degraded' : statusFromLatency(true, r.latencyMs),
    r.ok ? r.latencyMs : null,
    !r.ok ? 'Non raggiungibile' : secondo ? 'Rallentato: ha risposto al secondo tentativo' : null,
  );
}

async function checkPayments(): Promise<ServiceHealth> {
  if (!isStripeConfigured()) {
    return svc('payments', 'Pagamenti', 'Stripe Checkout + Connect', 'unknown', null, 'Non configurato');
  }
  const r = await timed(async () => {
    await getStripe().balance.retrieve();
  });
  return svc(
    'payments', 'Pagamenti', 'Stripe Checkout + Connect',
    statusFromLatency(r.ok, r.latencyMs),
    r.ok ? r.latencyMs : null,
    r.ok ? null : 'API non raggiungibile',
  );
}

/**
 * Il motivo di un guasto, detto in breve e in italiano per la pagina pubblica: il
 * testo grezzo (in inglese, per lo sviluppatore) resta nei log.
 */
function motivoPerIlPubblico(errore: string | undefined): string {
  if (!errore) return 'motivo sconosciuto';
  const http = /^HTTP (\d{3})$/.exec(errore);
  if (http) return `HTTP ${http[1]}`;
  if (/timeout|aborted/i.test(errore)) return 'tempo scaduto';
  return 'rete non raggiungibile';
}

async function checkEmail(): Promise<ServiceHealth> {
  const key = env.resendKey();
  if (!key) {
    return svc('email', 'Email transazionali', 'Resend (conferme ordine, recupero password)', 'unknown', null, 'Non configurato');
  }
  // 12/11/2026 (R06-024) — Una chiave di SOLO INVIO (la piu' prudente, quella giusta
  // per un sito) non puo' leggere l'elenco dei domini: Resend risponde 401
  // `restricted_api_key`. Non e' un guasto: la chiave c'e' ed e' valida. Prima
  // diventava «Non disponibile» sulla pagina pubblica, e il motivo vero (401,
  // tempo scaduto) veniva buttato senza finire nemmeno nei log.
  let soloInvio = false;
  const r = await timed(async () => {
    // GET read-only: verifica la raggiungibilità dell'API, non invia email.
    // Vedi checkAuth: `withTimeout` non chiude la chiamata, questo sì.
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) {
      const corpo = (await res.json().catch(() => null)) as { name?: unknown } | null;
      if (corpo?.name === 'restricted_api_key') {
        soloInvio = true;
        return;
      }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
  if (!r.ok) logger.warn('[salute] controllo della posta fallito', { motivo: r.error ?? 'sconosciuto' });
  return svc(
    'email', 'Email transazionali', 'Resend (conferme ordine, recupero password)',
    statusFromLatency(r.ok, r.latencyMs),
    r.ok ? r.latencyMs : null,
    r.ok
      ? (soloInvio ? 'Chiave di solo invio: raggiungibile' : null)
      : `API non raggiungibile (${motivoPerIlPubblico(r.error)})`,
  );
}

function checkPush(): ServiceHealth {
  const ok = !!env.vapidPublicKey() && !!env.vapidPrivateKey();
  return svc(
    'push', 'Notifiche push', 'Web Push API',
    ok ? 'operational' : 'unknown',
    null,
    ok ? null : 'Non configurato',
  );
}


/**
 * Servizi senza i quali il marketplace non funziona: se sono «non configurati»
 * la pagina pubblica NON puo' dire «tutto operativo».
 *
 * Prima diceva proprio questo: `unknown` (non configurato) non faceva scattare
 * nulla, quindi a pagamenti spenti e posta spenta la pagina dichiarava «tutto
 * operativo» — mentre nessun cliente poteva pagare e nessuna conferma d'ordine
 * partiva. Un cartello «funziona tutto» su un negozio con la serranda giu'.
 */
const SERVIZI_INDISPENSABILI = ['db', 'auth', 'payments', 'email', 'titolare'] as const;

function computeOverall(services: ServiceHealth[]): ServiceStatus {
  if (services.some((s) => s.status === 'outage')) return 'outage';
  if (services.some((s) => s.status === 'degraded')) return 'degraded';
  // Un servizio indispensabile non configurato conta come degradato.
  if (services.some((s) =>
    s.status === 'unknown' && (SERVIZI_INDISPENSABILI as readonly string[]).includes(s.id)
  )) {
    return 'degraded';
  }
  return 'operational';
}

async function runServiceChecks(): Promise<SystemHealth> {
  const [db, auth, payments, email] = await Promise.all([
    checkDb(),
    checkAuth(),
    checkPayments(),
    checkEmail(),
  ]);

  // Il web sta servendo questa pagina: se sei qui, è operativo.
  const web = svc('web', 'Marketplace web', 'Applicazione Next.js', 'operational', null, null);
  // Realtime vive sulla stessa piattaforma del DB: se il DB è giù, lo è anche lui.
  // 12/11/2026 (R06-023) — Senza le variabili pubbliche di Supabase il database e'
  // «non configurato», e la chat (stessa piattaforma) non puo' dirsi operativa.
  const realtime = svc(
    'realtime', 'Chat & notifiche', 'Supabase Realtime',
    db.status === 'outage' ? 'outage' : db.status === 'unknown' ? 'unknown' : 'operational',
    null,
    db.status === 'outage' ? 'Piattaforma non raggiungibile' : db.status === 'unknown' ? 'Non configurato' : null,
  );
  const push = checkPush();
  // 12/11/2026 (R06-023) — Questa e' la pagina PUBBLICA: l'elenco delle variabili
  // mancanti («… Vanno messe PRIMA di ricompilare») e' un messaggio per lo
  // sviluppatore, non per una cliente. Qui resta lo stato; il dettaglio completo
  // finisce nei log (e nessuna pagina admin lo mostra ancora: referto R06).
  const titolare = checkTitolare();
  // Il dettaglio non sparisce: va nei log, dove lo legge chi amministra.
  if (titolare.detail) logger.warn('[salute] dati del titolare incompleti', { dettaglio: titolare.detail });
  const titolareOk = { ...titolare, detail: titolare.status === 'operational' ? null : 'In completamento' };

  const services = [web, db, auth, payments, realtime, email, push, titolareOk];
  return {
    checkedAt: new Date().toISOString(),
    overall: computeOverall(services),
    services,
  };
}

/**
 * Versione in cache (60s) usata dalla pagina pubblica: limita le chiamate agli
 * endpoint esterni a una al minuto, a prescindere dal traffico.
 */
export const getSystemHealth = unstable_cache(runServiceChecks, ['system-health-v1'], {
  revalidate: 60,
});

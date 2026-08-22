import 'server-only';
import { unstable_cache } from 'next/cache';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { titolare } from '@/lib/legal/titolare';

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

async function checkDb(): Promise<ServiceHealth> {
  const r = await timed(async () => {
    const admin = getAdminSupabase();
    const { error } = await admin.from('categories').select('id').limit(1);
    if (error) throw new Error(error.message);
  });
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
  const r = await timed(async () => {
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
  return svc(
    'auth', 'Autenticazione', 'Accesso, registrazione, recupero password',
    statusFromLatency(r.ok, r.latencyMs),
    r.ok ? r.latencyMs : null,
    r.ok ? null : 'Non raggiungibile',
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

async function checkEmail(): Promise<ServiceHealth> {
  const key = env.resendKey();
  if (!key) {
    return svc('email', 'Email transazionali', 'Resend (conferme ordine, recupero password)', 'unknown', null, 'Non configurato');
  }
  const r = await timed(async () => {
    // GET read-only: verifica la raggiungibilità dell'API, non invia email.
    // Vedi checkAuth: `withTimeout` non chiude la chiamata, questo sì.
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
  return svc(
    'email', 'Email transazionali', 'Resend (conferme ordine, recupero password)',
    statusFromLatency(r.ok, r.latencyMs),
    r.ok ? r.latencyMs : null,
    r.ok ? null : 'API non raggiungibile',
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
 * 22/8/2026 — I DATI DEL TITOLARE NON ERANO DICHIARATI DA NESSUNA PARTE.
 *
 * L'informativa privacy, i termini e la pagina dei contatti leggono nove
 * variabili con dentro nome, indirizzo, partita IVA, PEC e capitale sociale.
 * Nessuna delle nove era dichiarata fra le variabili del progetto.
 *
 * E c'e' un dettaglio che rende il difetto peggiore di quanto sembri: quelle
 * variabili finiscono dentro il pacchetto al momento in cui il sito viene
 * COMPILATO. Se mancano in quel momento restano vuote per sempre nel sito
 * pubblicato — metterle dopo non basta, serve ricompilare. Il codice ripiega su
 * un generico «MyCity» e omette il resto, quindi la pagina esce senza errori e
 * sembra a posto.
 *
 * Un'informativa privacy senza i dati del titolare non e' un'informativa: e'
 * quello che un'ispezione guarda per primo.
 *
 * Qui non si puo' riempirle — sono decisioni e dati veri di Nicola — ma si puo'
 * smettere di far finta che vada tutto bene. Se mancano, la salute dice
 * «degradato» e la pagina lo mostra.
 */
function checkTitolare(): ServiceHealth {
  const dati = titolare();
  const mancanti: string[] = [];
  if (!dati.indirizzo) mancanti.push('indirizzo');
  if (!dati.partitaIva) mancanti.push('partita IVA');
  if (!dati.pec) mancanti.push('PEC');
  if (dati.denominazione === 'MyCity') mancanti.push('denominazione');
  return svc(
    'titolare', 'Dati del titolare', 'Informativa privacy e termini',
    mancanti.length === 0 ? 'operational' : 'unknown',
    null,
    mancanti.length === 0
      ? null
      : `Mancano nelle variabili del progetto: ${mancanti.join(', ')}. Vanno messe PRIMA di ricompilare.`,
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
  const realtime = svc(
    'realtime', 'Chat & notifiche', 'Supabase Realtime',
    db.status === 'outage' ? 'outage' : 'operational',
    null,
    db.status === 'outage' ? 'Piattaforma non raggiungibile' : null,
  );
  const push = checkPush();
  const titolareOk = checkTitolare();

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

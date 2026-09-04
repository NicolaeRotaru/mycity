/**
 * Punto di lettura PREFERITO delle env vars dell'app. Server-only quando non
 * hanno prefisso NEXT_PUBLIC_. Importare solo da codice server (API routes,
 * server components, middleware) se contiene secret.
 *
 * Le funzioni `requireXxx()` lanciano se manca una var critica.
 * Le funzioni `xxxOrNull()` restituiscono null se manca, utili per
 * feature opzionali (es. Stripe / Resend / Turnstile) che vanno
 * abilitate solo quando le chiavi sono configurate.
 *
 * Eccezioni note (lette direttamente da process.env per design — audit 🟡-20):
 *  - `NEXT_PUBLIC_*` dentro i Client Component (es. PostHog, WhatsApp): Next le
 *    inline-a a build-time nel bundle, quindi si leggono al punto d'uso.
 *  - Secret infrastrutturali letti al loro use-site per località: `CRON_SECRET`
 *    e `INTERNAL_API_SECRET` (lib/api/middleware), `UPSTASH_*` (lib/rate-limit),
 *    `SUPABASE_*` nel root middleware (hot path, evita l'import del modulo env).
 * Tutto il resto passa da qui.
 */

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export const env = {
  // Supabase
  supabaseUrl: () => readEnv('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: () => readEnv('SUPABASE_SERVICE_ROLE_KEY'),

  // Anthropic (vision)
  anthropicKey: () => readEnv('ANTHROPIC_API_KEY'),

  // Stripe (pagamenti)
  stripeSecretKey: () => readEnv('STRIPE_SECRET_KEY'),
  stripePublishableKey: () => readEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'),
  stripeWebhookSecret: () => readEnv('STRIPE_WEBHOOK_SECRET'),
  stripeConnectClientId: () => readEnv('STRIPE_CONNECT_CLIENT_ID'),

  // Resend (email transazionale)
  resendKey: () => readEnv('RESEND_API_KEY'),
  resendFrom: () => readEnv('RESEND_FROM') ?? 'MyCity <no-reply@example.com>',
  resendReplyTo: () => readEnv('RESEND_REPLY_TO'),

  // Cloudflare Turnstile (CAPTCHA)
  turnstileSiteKey: () => readEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY'),
  turnstileSecretKey: () => readEnv('TURNSTILE_SECRET_KEY'),

  // KYC provider (Onfido di default)
  kycProvider: () => (readEnv('KYC_PROVIDER') ?? 'mock') as 'onfido' | 'jumio' | 'veriff' | 'mock',
  kycApiKey: () => readEnv('KYC_API_KEY'),

  // Rimozione sfondo foto prodotto (provider esterno a pagamento).
  // In produzione, se il provider reale non e' configurato, l'endpoint risponde 503.
  bgRemovalProvider: () => (readEnv('BG_REMOVAL_PROVIDER') ?? 'mock') as 'removebg' | 'photoroom' | 'mock',
  removeBgApiKey: () => readEnv('REMOVE_BG_API_KEY'),
  photoroomApiKey: () => readEnv('PHOTOROOM_API_KEY'),

  // Sentry (error tracking) — solo wiring qui, attivazione separata
  sentryDsn: () => readEnv('NEXT_PUBLIC_SENTRY_DSN'),

  // Google Analytics 4 (caricato solo con consenso analytics)
  gaMeasurementId: () => readEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID'),

  // Web Push (VAPID keys per notifiche push browser-native)
  vapidPublicKey: () => readEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY'),
  vapidPrivateKey: () => readEnv('VAPID_PRIVATE_KEY'),
  vapidSubject: () => readEnv('VAPID_SUBJECT') ?? 'mailto:no-reply@mycity.it',

  // App URL pubblico (per link in email, redirect Stripe, ecc.)
  appUrl: () => indirizzoPubblico().url,
};

/**
 * Il dominio con cui MyCity si presenta al mondo, scritto una volta sola.
 *
 * È l'ultima rete di sicurezza, non la configurazione: il dominio vero lo
 * decide NEXT_PUBLIC_APP_URL. Ma se in rete quella variabile manca e Vercel
 * non ci dice niente, è meglio dichiarare un indirizzo NOSTRO — anche se il
 * dominio non è ancora agganciato — che dichiarare «localhost», che per Google
 * vale «questa pagina non esiste» e per WhatsApp «anteprima rotta».
 */
export const DOMINIO_PUBBLICO = 'https://mycity-marketplace.com';

/** Da dove arriva l'indirizzo pubblico: serve per poterlo dire ad alta voce. */
export type FonteIndirizzo =
  | 'variabile' // NEXT_PUBLIC_APP_URL: la strada giusta
  | 'dominio-di-produzione' // il dominio che ci dà Vercel per il progetto
  | 'questa-pubblicazione' // l'indirizzo di questa singola anteprima
  | 'dominio-di-riserva' // DOMINIO_PUBBLICO: siamo in rete e nessuno ce l'ha detto
  | 'computer-di-sviluppo'; // localhost: solo mentre si sviluppa

/** Toglie la barra finale e mette il protocollo se chi configura l'ha scordato. */
function normalizzaIndirizzo(valore: string): string {
  const conProtocollo = /^https?:\/\//i.test(valore) ? valore : `https://${valore}`;
  return conProtocollo.replace(/\/+$/, '');
}

/**
 * Vero quando il codice NON gira sul computer di chi sviluppa.
 * Su Vercel c'è sempre VERCEL_ENV; fuori da Vercel, una build di produzione
 * che gira davvero ha NODE_ENV=production.
 */
function siamoInRete(): boolean {
  return (
    readEnv('VERCEL') === '1' ||
    readEnv('VERCEL_ENV') !== undefined ||
    readEnv('NEXT_PUBLIC_VERCEL_ENV') !== undefined ||
    process.env.NODE_ENV === 'production'
  );
}

/**
 * L'indirizzo pubblico del sito, e da dove l'abbiamo preso.
 *
 * PUNTO UNICO. Ogni file che parla a Google teneva la sua copia della stessa
 * riga: `app/layout.tsx` (canonical, og:url, dati strutturati), `app/robots.ts`
 * e `app/sitemap.ts` calcolavano l'indirizzo per conto proprio, e tutti e tre
 * ripiegavano su `http://localhost:3000`. Bastava che la variabile mancasse su
 * Vercel perché ripiegassero insieme.
 *
 * PERCHE' ESISTE. Il 22/8/2026, a sito già spostato su Vercel, il ripiego era
 * dritto su `http://localhost:3000` — e quella variabile su Vercel non era
 * stata messa. Risultato in produzione, controllabile guardando l'HTML che il
 * sito serviva davvero:
 *
 *   <link rel="canonical" href="http://localhost:3000">
 *   <meta property="og:url"   content="http://localhost:3000">
 *   <meta property="og:image" content="http://localhost:3000/opengraph-image?…">
 *
 * Cioè: a Google stavamo dichiarando che l'indirizzo ufficiale di ogni pagina è
 * un computer che non esiste, e ogni link condiviso su WhatsApp o Facebook
 * mostrava l'anteprima rotta. Nessun errore nei log, nessun allarme: il sito
 * rispondeva 200 e sembrava a posto.
 *
 * Un ripiego che punta al computer di chi sviluppa va bene solo mentre si
 * sviluppa. In rete deve puntare a qualcosa che in rete esiste — e Vercel ci
 * dice sempre due indirizzi veri, senza che nessuno debba configurarli:
 * il dominio di produzione del progetto, e l'indirizzo di questa singola
 * pubblicazione (che è quello giusto per le anteprime delle proposte di
 * modifica, dove puntare alla produzione sarebbe sbagliato).
 *
 * Resta vero che NEXT_PUBLIC_APP_URL va messa: è lei a decidere il dominio con
 * cui il sito si presenta, ed è per questo che /api/health continua a dire
 * «non sto in piedi» finché manca. Questo è il paracadute, non la scala.
 */
export function indirizzoPubblico(): { url: string; fonte: FonteIndirizzo } {
  const dichiarato = readEnv('NEXT_PUBLIC_APP_URL');
  if (dichiarato) return { url: normalizzaIndirizzo(dichiarato), fonte: 'variabile' };

  const dominioDiProduzione = readEnv('NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL');
  const questaPubblicazione = readEnv('NEXT_PUBLIC_VERCEL_URL');
  // In un'anteprima si resta sull'anteprima: mandare un pagamento di prova a
  // rimbalzare sulla produzione è peggio del problema che si sta risolvendo.
  const anteprima =
    readEnv('NEXT_PUBLIC_VERCEL_ENV') === 'preview' || readEnv('VERCEL_ENV') === 'preview';
  const ordine: Array<[string | undefined, FonteIndirizzo]> = anteprima
    ? [
        [questaPubblicazione, 'questa-pubblicazione'],
        [dominioDiProduzione, 'dominio-di-produzione'],
      ]
    : [
        [dominioDiProduzione, 'dominio-di-produzione'],
        [questaPubblicazione, 'questa-pubblicazione'],
      ];
  for (const [host, fonte] of ordine) {
    if (host) return { url: normalizzaIndirizzo(host), fonte };
  }

  // In rete il nome del computer di chi sviluppa non si pronuncia mai: è quello
  // il difetto che stiamo chiudendo. Meglio un dominio nostro non ancora
  // agganciato che «localhost» scritto nel canonical di ogni pagina.
  if (siamoInRete()) return { url: DOMINIO_PUBBLICO, fonte: 'dominio-di-riserva' };
  return { url: 'http://localhost:3000', fonte: 'computer-di-sviluppo' };
}

export function requireSupabasePublic() {
  const url = env.supabaseUrl();
  const key = env.supabaseAnonKey();
  if (!url || !key) {
    throw new Error('Variabili Supabase mancanti: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return { url, key };
}

export function requireSupabaseService() {
  const url = env.supabaseUrl();
  const key = env.supabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error('Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY).');
  }
  return { url, key };
}

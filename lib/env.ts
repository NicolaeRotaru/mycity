/**
 * Centralizza lettura env vars. Server-only quando non hanno prefisso
 * NEXT_PUBLIC_. Importare solo da codice server (API routes, server
 * components, middleware) se contiene secret.
 *
 * Le funzioni `requireXxx()` lanciano se manca una var critica.
 * Le funzioni `xxxOrNull()` restituiscono null se manca, utili per
 * feature opzionali (es. Stripe / Resend / Turnstile) che vanno
 * abilitate solo quando le chiavi sono configurate.
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

  // SDI fatturazione (FattureInCloud di default)
  sdiProvider: () => (readEnv('SDI_PROVIDER') ?? 'fattureincloud') as 'fattureincloud' | 'aruba' | 'mock',
  sdiApiKey: () => readEnv('SDI_API_KEY'),
  sdiCompanyId: () => readEnv('SDI_COMPANY_ID'),

  // KYC provider (Onfido di default)
  kycProvider: () => (readEnv('KYC_PROVIDER') ?? 'mock') as 'onfido' | 'jumio' | 'veriff' | 'mock',
  kycApiKey: () => readEnv('KYC_API_KEY'),

  // Sentry (error tracking) — solo wiring qui, attivazione separata
  sentryDsn: () => readEnv('NEXT_PUBLIC_SENTRY_DSN'),

  // App URL pubblico (per link in email, redirect Stripe, ecc.)
  appUrl: () => readEnv('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000',
};

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

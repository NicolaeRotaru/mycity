import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stesso stampo di api-health.test.ts: il database risponde, cosi' l'unica cosa
// che puo' far cambiare colore al semaforo sono le variabili.
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({ select: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve({ error: null })) })) })),
  })),
}));

import { GET } from '@/app/api/health/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/**
 * IL SEMAFORO GUARDAVA MENO DI META' DI QUELLO CHE CONTA.
 *
 * Radiografia del 27/8/2026 (R184). `/api/health` e' la finestra da cui si
 * capisce se il sito e' configurato bene: elenca le variabili mancanti e i
 * cruscotti lo leggono. Ma l'elenco delle variabili «importanti» ne conteneva
 * cinque, e fuori ne erano rimaste sette che, se mancano, spengono in silenzio
 * un pezzo di marketplace:
 *
 *  · UPSTASH_REDIS_REST_TOKEN — meta' coppia. Il freno anti-abuso vuole URL
 *    **e** token: `lib/rate-limit.ts:143` ripiega sul contatore in memoria se
 *    ne manca uno solo. Con l'URL presente e il token no, il semaforo era verde
 *    e il freno era gia' largo dieci volte tanto. Mezza coppia e' peggio di
 *    zero: zero non mente.
 *  · INTERNAL_API_SECRET  — le rotte interne rispondono 503.
 *  · UNSUBSCRIBE_SECRET   — i link di disiscrizione non si firmano (e la legge
 *    li vuole funzionanti).
 *  · MIDDLEWARE_CACHE_SECRET — il cookie firmato del ruolo non si fa.
 *  · SUPPORT_EMAIL        — nessuno riceve gli allarmi operativi.
 *  · VAPID_PRIVATE_KEY / NEXT_PUBLIC_VAPID_PUBLIC_KEY — niente notifiche push.
 *
 * Questa prova non cerca parole in un file: mette l'ambiente in piedi con tutto
 * al posto giusto, toglie UNA variabile per volta, chiama la rotta vera e
 * pretende che il semaforo se ne accorga. Se qualcuno domani toglie una voce
 * dall'elenco, qui diventa rosso.
 */

const TUTTE_LE_IMPORTANTI: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  RESEND_API_KEY: 're_test',
  CRON_SECRET: 'cron_test',
  UPSTASH_REDIS_REST_URL: 'https://upstash.test',
  UPSTASH_REDIS_REST_TOKEN: 'tok_test',
  INTERNAL_API_SECRET: 'int_test',
  UNSUBSCRIBE_SECRET: 'unsub_test',
  MIDDLEWARE_CACHE_SECRET: 'mid_test',
  SUPPORT_EMAIL: 'aiuto@mycity.test',
  VAPID_PRIVATE_KEY: 'vapid_priv',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'vapid_pub',
};

let contatore = 0;
function req(): Request {
  contatore++;
  return new Request('https://mycity.test/api/health', {
    headers: { 'x-forwarded-for': `10.9.0.${contatore % 250}` },
  });
}

async function semaforo(): Promise<{ ok: boolean; error?: string }> {
  const res = await GET(req());
  const json = await res.json();
  return json.checks.envOpzionali;
}

describe('il semaforo delle variabili guarda i segreti che contano', () => {
  const salvato = { ...process.env };

  beforeEach(() => {
    __resetRateLimitBuckets();
    // Le vitali, senza le quali la rotta risponde 503 e non si misura niente.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    for (const [k, v] of Object.entries(TUTTE_LE_IMPORTANTI)) process.env[k] = v;
  });

  afterEach(() => {
    process.env = { ...salvato };
  });

  it('con tutto al posto giusto il semaforo e verde', async () => {
    const esito = await semaforo();
    expect(esito.ok, `il semaforo si lamenta di: ${esito.error}`).toBe(true);
  });

  for (const nome of Object.keys(TUTTE_LE_IMPORTANTI)) {
    it(`se manca ${nome} il semaforo lo dice`, async () => {
      delete process.env[nome];
      const esito = await semaforo();
      expect(esito.ok, `${nome} manca e il semaforo resta verde: nessuno se ne accorgerebbe`).toBe(false);
      expect(esito.error ?? '').toContain(nome);
    });
  }

  /**
   * Il caso che ha dato il nome al difetto: mezza coppia Upstash. L'URL c'e',
   * il token no. Il freno anti-abuso ripiega in silenzio sul contatore in
   * memoria — su Vercel vuol dire un contatore per copia — e chi guarda il
   * cruscotto legge «tutto a posto».
   */
  it('mezza coppia Upstash non passa per buona', async () => {
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const esito = await semaforo();
    expect(esito.ok).toBe(false);
    expect(esito.error ?? '').toContain('UPSTASH_REDIS_REST_TOKEN');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 30/8/2026 (R183) — IL SORVEGLIANTE NON AVEVA NESSUNO CHE SORVEGLIASSE LUI.
 *
 * I lavori periodici lasciano un battito, e `operational-alerts` segnala quelli
 * che hanno smesso di batterlo. Ma lui stesso resta fuori dall'elenco — non puo'
 * guardarsi da solo — e `lib/cron-health.ts` dichiarava: «Quel caso resta
 * coperto dal monitor uptime esterno su /api/health».
 *
 * Non era vero. La rotta di salute guardava due cose sole: il database e le
 * variabili d'ambiente. Se il sorvegliante moriva, il monitor esterno restava
 * verde — e con lui smetteva di guardare TUTTO il resto: ordini fermi, negozi
 * non pagati, contanti che non quadrano. Il modo piu' costoso di rompersi:
 * sembra tutto a posto mentre non guarda piu' nessuno.
 *
 * Adesso la rotta di salute legge i battiti e li confronta con le soglie, il
 * sorvegliante compreso. Questa prova non cerca parole in un file: mette dei
 * battiti veri nel finto database, chiama la rotta e pretende che il colore
 * cambi.
 */

type Battito = { name: string; last_run_at: string | null };

const state: { battiti: Battito[]; errore: { message: string } | null } = {
  battiti: [],
  errore: null,
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'cron_heartbeats') {
        return { select: () => Promise.resolve({ data: state.battiti, error: state.errore }) };
      }
      // La query di vivacita' del database: risponde bene, cosi' l'unica cosa
      // che puo' far cambiare colore al semaforo sono i battiti.
      return { select: () => ({ limit: () => Promise.resolve({ error: null }) }) };
    },
  })),
}));

import { GET } from '@/app/api/health/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Tutti i lavori hanno battuto un colpo un minuto fa: nessuno e' fermo. */
function tuttiVivi(): Battito[] {
  return [
    'release-payouts',
    'send-emails',
    'send-push',
    'expire-checkouts',
    'expire-stale-orders',
    'abandoned-carts',
    'process-deletions',
    'external-price-alerts',
    'riquadra-casse',
    'operational-alerts',
  ].map((name) => ({ name, last_run_at: minutiFa(1) }));
}

let contatore = 0;
function req(): Request {
  contatore++;
  return new Request('https://mycity.test/api/health', {
    headers: { 'x-forwarded-for': `10.7.0.${contatore % 250}` },
  });
}

async function salute() {
  const res = await GET(req());
  return { stato: res.status, corpo: await res.json() };
}

describe('la rotta di salute guarda anche i battiti dei lavori periodici', () => {
  const salvato = { ...process.env };

  beforeEach(() => {
    __resetRateLimitBuckets();
    state.errore = null;
    state.battiti = tuttiVivi();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    for (const k of [
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'CRON_SECRET',
      'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'INTERNAL_API_SECRET',
      'UNSUBSCRIBE_SECRET', 'MIDDLEWARE_CACHE_SECRET', 'SUPPORT_EMAIL',
      'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AI_GLOBAL_DAILY_BUDGET_EUR',
    ]) process.env[k] = 'x';
  });

  afterEach(() => {
    process.env = { ...salvato };
  });

  it('con tutti i lavori che battono, il semaforo e verde', async () => {
    const { stato, corpo } = await salute();
    expect(stato).toBe(200);
    expect(corpo.status, `si lamenta di: ${JSON.stringify(corpo.checks)}`).toBe('ok');
    expect(corpo.checks.cron.ok).toBe(true);
  });

  it('un lavoro fermo da ore fa diventare il semaforo giallo', async () => {
    // send-emails ha cadenza 10 minuti e soglia 120: fermo da 300 e' morto.
    state.battiti = tuttiVivi().map((b) =>
      b.name === 'send-emails' ? { ...b, last_run_at: minutiFa(300) } : b,
    );
    const { stato, corpo } = await salute();
    expect(stato).toBe(200);
    expect(
      corpo.status,
      'le email non partono da cinque ore e chi sorveglia il sito legge «tutto a posto»',
    ).toBe('degraded');
    expect(corpo.checks.cron.ok).toBe(false);
    expect(corpo.checks.cron.error ?? '').toContain('send-emails');
  });

  /**
   * Il caso che da' il nome al difetto. `operational-alerts` e' l'unico lavoro
   * che non compare nell'elenco delle soglie, perche' non puo' accorgersi da
   * solo di essere morto. Da qui invece si vede — ed e' l'unico posto da cui si
   * puo' vedere.
   */
  it('e se a fermarsi e il sorvegliante stesso, lo dice comunque', async () => {
    state.battiti = tuttiVivi().map((b) =>
      b.name === 'operational-alerts' ? { ...b, last_run_at: minutiFa(600) } : b,
    );
    const { corpo } = await salute();
    expect(
      corpo.status,
      'il sorvegliante e morto: da fuori nessuno se ne accorge, e intanto ha smesso di guardare tutto il resto',
    ).toBe('degraded');
    expect(corpo.checks.cron.error ?? '').toContain('operational-alerts');
  });

  it('se i battiti non si riescono nemmeno a leggere, non si dichiara sano', async () => {
    state.errore = { message: 'connection refused' };
    const { corpo } = await salute();
    expect(
      corpo.status,
      'non ha potuto guardare i battiti e risponde lo stesso «tutto a posto»',
    ).toBe('degraded');
    expect(corpo.checks.cron.ok).toBe(false);
  });

  it('un lavoro fermo non fa riavviare il processo: e degradato, non morto', async () => {
    // 503 su questa rotta vuol dire «ammazza il processo»: un cron fermo non si
    // ripara riavviando il sito, e riavviare mentre un lavoro e' indietro fa
    // solo danni.
    state.battiti = tuttiVivi().map((b) =>
      b.name === 'release-payouts' ? { ...b, last_run_at: minutiFa(999) } : b,
    );
    const { stato } = await salute();
    expect(stato).toBe(200);
  });
});

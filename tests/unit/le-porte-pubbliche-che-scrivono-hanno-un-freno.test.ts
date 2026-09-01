import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * LE DUE PORTE PUBBLICHE CHE SCRIVONO SUL DATABASE HANNO UN FRENO.
 *
 * 27/8/2026 (R140) — `/api/newsletter/confirm` e `/api/unsubscribe` sono due GET
 * pubblici, aperti al mondo, e ognuno fa una scrittura vera per ogni chiamata:
 * il primo un UPDATE su `newsletter_subscribers`, il secondo la funzione
 * `disiscrivi` del database. Nessuno dei due aveva un limite di frequenza.
 *
 * La firma del gettone protegge il DATO — nessuno può disiscrivere l'indirizzo
 * di un altro — ma non protegge la MACCHINA: un client solo poteva tenere
 * occupato il database con richieste anonime, senza mai indovinare un gettone.
 *
 * Il freno è largo apposta: un link di conferma o di disiscrizione si clicca
 * una volta, e i client di posta che aprono i link in anticipo ne fanno
 * pochissime. Sopra soglia la persona vede comunque una pagina, non un errore.
 */

const scritture = { newsletter: 0, disiscrizioni: 0 };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));
vi.mock('@/lib/email/unsubscribe', () => ({
  verificaDisiscrizione: () => ({ email: 'mario@example.com', ambito: 'marketing' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              scritture.newsletter++;
              return { data: { id: 'n1' }, error: null };
            },
          }),
        }),
      }),
    }),
    rpc: async () => {
      scritture.disiscrizioni++;
      return { data: { ok: true, newsletter: 1, profilo: 0 }, error: null };
    },
  }),
}));

import { GET as CONFERMA } from '@/app/api/newsletter/confirm/route';
import { GET as DISISCRIVI } from '@/app/api/unsubscribe/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function bussa(chiamata: (r: Request) => Promise<Response>, indirizzo: string) {
  return chiamata(new Request('https://mycity.test/x?token=abcdef0123456789', {
    headers: { 'x-forwarded-for': indirizzo },
  }));
}

beforeEach(() => {
  scritture.newsletter = 0;
  scritture.disiscrizioni = 0;
  __resetRateLimitBuckets();
});

describe('la conferma della newsletter', () => {
  it('IL CASO CHE ROMPEVA — a raffica dallo stesso indirizzo smette di scrivere sul database', async () => {
    for (let i = 0; i < 30; i++) await bussa(CONFERMA, '203.0.113.9');
    const scrittePrima = scritture.newsletter;

    const res = await bussa(CONFERMA, '203.0.113.9');

    expect(
      scritture.newsletter,
      'ogni richiesta anonima continua a costare una scrittura sul database',
    ).toBe(scrittePrima);
    expect(res.status, 'chi ha cliccato davvero deve vedere una pagina, non un errore').toBe(307);
  });

  it('chi arriva da un altro indirizzo passa: il freno non è una porta chiusa', async () => {
    for (let i = 0; i < 31; i++) await bussa(CONFERMA, '203.0.113.9');
    const scrittePrima = scritture.newsletter;

    await bussa(CONFERMA, '203.0.113.10');

    expect(scritture.newsletter).toBe(scrittePrima + 1);
  });
});

describe('la disiscrizione con un clic', () => {
  it('IL CASO CHE ROMPEVA — a raffica smette di chiamare la funzione del database', async () => {
    for (let i = 0; i < 30; i++) await bussa(DISISCRIVI, '203.0.113.20');
    const chiamatePrima = scritture.disiscrizioni;

    const res = await bussa(DISISCRIVI, '203.0.113.20');

    expect(scritture.disiscrizioni).toBe(chiamatePrima);
    expect(res.status).toBe(307);
  });

  it('la prima disiscrizione passa e va a buon fine', async () => {
    const res = await bussa(DISISCRIVI, '203.0.113.21');
    expect(scritture.disiscrizioni).toBe(1);
    expect(res.headers.get('location')).toContain('disiscrizione=fatta');
  });
});

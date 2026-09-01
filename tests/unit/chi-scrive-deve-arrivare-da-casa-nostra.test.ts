import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * 30/8/2026 (R022) — CONTRO LA FALSIFICAZIONE DA UN ALTRO SITO NON C'ERA
 * NESSUNA DIFESA NOSTRA.
 *
 * Le rotte che scrivono — annullare un ordine, decidere un reso, confermare un
 * incasso in contanti, moderare — si autenticano col cookie di sessione. Non
 * c'era nessun gettone anti-falsificazione e nessun controllo di provenienza:
 * una pagina ostile aperta in un'altra scheda poteva far partire una richiesta
 * verso di noi, e il browser ci avrebbe attaccato il cookie di chi era entrato.
 *
 * Oggi non passa niente, ma per un motivo che non è nostro: `@supabase/ssr`
 * scrive i cookie con `SameSite=Lax` di suo. È una protezione EREDITATA. Il
 * giorno che quel valore predefinito cambia — o che qualcuno mette
 * `sameSite: 'none'` per far funzionare un incorporamento — cadono insieme
 * tutte le rotte che scrivono, in una volta e senza nessun segnale.
 *
 * Adesso la difesa è nostra, sta dentro `authenticate()` (il punto per cui
 * passano tutte le rotte), e questa prova la esercita davvero: bussa con
 * l'involucro vero e guarda se il lavoro viene fatto.
 */

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser,
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: 'u-1', role: 'buyer', is_approved: true } })),
        })),
      })),
    })),
  })),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { withAuth } from '@/lib/api/middleware';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const NOSTRO = 'https://mycity.it';

let quanteVolteHaLavorato = 0;
const rotta = withAuth(async () => {
  quanteVolteHaLavorato += 1;
  return { status: 200 } as never;
});

function bussa(
  metodo: string,
  intestazioni: Record<string, string>,
  ip = '203.0.113.7',
): NextRequest {
  return {
    method: metodo,
    headers: new Headers({ 'x-forwarded-for': ip, host: 'mycity.it', ...intestazioni }),
    nextUrl: { pathname: '/api/orders/annulla' },
    url: `${NOSTRO}/api/orders/annulla`,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  quanteVolteHaLavorato = 0;
  delete process.env.UPSTASH_REDIS_REST_URL;
  process.env.NEXT_PUBLIC_APP_URL = NOSTRO;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  // C'è una sessione valida: è il caso pericoloso, quello in cui il browser
  // attaccherebbe il cookie a una richiesta partita da un'altra pagina.
  getCurrentUser.mockResolvedValue({ id: 'u-1', email: 'maria@test.it' });
});

describe('una richiesta che scrive, partita da un altro sito', () => {
  it('viene rifiutata quando il browser dichiara che arriva da fuori', async () => {
    const res = await rotta(bussa('POST', { 'sec-fetch-site': 'cross-site' }));

    expect(res.status, 'una pagina ostile ha potuto far scrivere con il cookie di chi era entrato').toBe(403);
    expect(quanteVolteHaLavorato, 'il lavoro e stato fatto lo stesso').toBe(0);
  });

  it('viene rifiutata quando l origine non e la nostra', async () => {
    const res = await rotta(bussa('POST', { origin: 'https://sito-ostile.example' }));
    expect(res.status).toBe(403);
    expect(quanteVolteHaLavorato).toBe(0);
  });

  it('nemmeno se l origine ci somiglia', async () => {
    const res = await rotta(bussa('POST', { origin: 'https://mycity.it.sito-ostile.example' }));
    expect(res.status).toBe(403);
  });
});

describe('quello che deve continuare a passare', () => {
  it('il nostro stesso sito scrive senza problemi', async () => {
    const res = await rotta(bussa('POST', { origin: NOSTRO, 'sec-fetch-site': 'same-origin' }));
    expect(res.status, 'il controllo rifiuta le richieste del nostro stesso sito').toBe(200);
    expect(quanteVolteHaLavorato).toBe(1);
  });

  it('una lettura da un altro sito resta permessa: non cambia niente', async () => {
    const res = await rotta(bussa('GET', { 'sec-fetch-site': 'cross-site' }));
    expect(res.status).toBe(200);
  });

  it('chi non e un browser — un app col gettone — passa: l Origin non lo manda nessuno', async () => {
    const res = await rotta(bussa('POST', {}));
    expect(res.status, 'le chiamate che non arrivano da un browser sono state bloccate').toBe(200);
  });

  it('anche su un dominio di anteprima, dove l indirizzo configurato non combacia', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.it';
    const anteprima = {
      method: 'POST',
      headers: new Headers({
        'x-forwarded-for': '203.0.113.9',
        host: 'anteprima-123.vercel.app',
        origin: 'https://anteprima-123.vercel.app',
      }),
      nextUrl: { pathname: '/api/orders/annulla' },
      url: 'https://anteprima-123.vercel.app/api/orders/annulla',
    } as unknown as NextRequest;

    expect((await rotta(anteprima)).status).toBe(200);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser,
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: null })) })) })) })),
  })),
}));

import { withAuth, withSellerAuth, withAdminAuth, chiaveDelFreno } from '@/lib/api/middleware';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/**
 * LA CURA ERA STATA MESSA SU TRE GUARDIANI SU SEI.
 *
 * Radiografia del 27/8/2026 (R003 e R020). Il 22 agosto era stato aggiunto un
 * freno per indirizzo di rete PRIMA dell'autenticazione, e la ragione stava
 * scritta chiara nel commento: chi bussa senza un gettone valido costa comunque
 * due chiamate di rete a testa — la verifica del gettone e la lettura del
 * profilo — e diecimila tentativi al minuto da un solo indirizzo sono ventimila
 * chiamate pagate da noi per respingere sempre la stessa persona.
 *
 * Ma il freno era finito solo nei tre involucri col rate limit
 * (`with*AuthRateLimit`), non nei tre semplici (`withAuth`, `withSellerAuth`,
 * `withAdminAuth`) — che sono quelli usati dal doppio delle rotte. Metà delle
 * porte aveva la serratura, l'altra metà no, e non c'era modo di accorgersene.
 *
 * Adesso il freno sta dentro `authenticate()`, il punto per cui passano tutti e
 * sei. Queste prove bussano davvero, tante volte, e guardano due cose: che a un
 * certo punto la risposta diventi 429, e — piu' importante — che il codice
 * SMETTA di andare in rete. Un freno che risponde 429 dopo aver comunque
 * chiamato Supabase non ha risolto niente.
 */

const TETTO_PER_RETE = 300;

function req(ip: string, percorso = '/api/prova'): NextRequest {
  return {
    headers: new Headers({ 'x-forwarded-for': ip }),
    nextUrl: { pathname: percorso },
    url: `http://localhost${percorso}`,
  } as unknown as NextRequest;
}

const involucri = [
  ['withAuth', withAuth],
  ['withSellerAuth', withSellerAuth],
  ['withAdminAuth', withAdminAuth],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  delete process.env.UPSTASH_REDIS_REST_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  // Nessuna sessione: e' il caso di chi bussa a vuoto, quello che va frenato.
  getCurrentUser.mockResolvedValue(null);
});

describe('il freno per indirizzo di rete c e su tutti i guardiani, non su meta', () => {
  for (const [nome, involucro] of involucri) {
    it(`${nome}: una raffica dallo stesso indirizzo finisce a 429`, async () => {
      const rotta = involucro(async () => ({ status: 200 }) as never);
      const ip = `203.0.113.${nome.length}`;

      let ultima = 0;
      for (let i = 0; i <= TETTO_PER_RETE + 5; i++) {
        ultima = (await rotta(req(ip, `/api/${nome}`))).status;
      }

      expect(
        ultima,
        `${nome} continua a rispondere ${ultima} dopo ${TETTO_PER_RETE + 5} tentativi dallo stesso indirizzo: nessun freno`,
      ).toBe(429);
    });

    it(`${nome}: oltre il tetto smette proprio di andare in rete`, async () => {
      const rotta = involucro(async () => ({ status: 200 }) as never);
      const ip = `198.51.100.${nome.length}`;
      const percorso = `/api/rete-${nome}`;

      for (let i = 0; i < TETTO_PER_RETE; i++) await rotta(req(ip, percorso));
      const chiamatePrima = getCurrentUser.mock.calls.length;

      // Le prossime venti sono oltre il tetto: non devono costare niente.
      for (let i = 0; i < 20; i++) await rotta(req(ip, percorso));

      expect(
        getCurrentUser.mock.calls.length,
        `${nome} risponde 429 ma va lo stesso a chiedere a Supabase: il costo lo paghiamo comunque`,
      ).toBe(chiamatePrima);
    });
  }

  it('il freno e per indirizzo: un altro visitatore non paga per la raffica di uno', async () => {
    const rotta = withAuth(async () => ({ status: 200 }) as never);
    for (let i = 0; i <= TETTO_PER_RETE + 5; i++) await rotta(req('203.0.113.99', '/api/condiviso'));

    // Un ufficio dietro un altro indirizzo deve poter lavorare.
    const altro = await rotta(req('203.0.113.100', '/api/condiviso'));
    expect(altro.status, 'un visitatore innocente e stato frenato per colpa di un altro').toBe(401);
  });

  it('il freno e per rotta: riempire una rotta non chiude tutte le altre', async () => {
    const rotta = withAuth(async () => ({ status: 200 }) as never);
    const ip = '192.0.2.7';
    for (let i = 0; i <= TETTO_PER_RETE + 5; i++) await rotta(req(ip, '/api/una'));

    const altra = await rotta(req(ip, '/api/altra'));
    expect(altra.status, 'una raffica su una rotta ha spento tutto il resto del sito').toBe(401);
  });

  /**
   * La chiave del contatore non puo' contenere l'identificativo della risorsa,
   * o cambiare il numero in fondo all'indirizzo azzera il freno.
   */
  describe('la chiave del contatore e la rotta, non la singola risorsa', () => {
    it('i numeri in fondo diventano tutti la stessa chiave', () => {
      expect(chiaveDelFreno('/api/orders/1')).toBe(chiaveDelFreno('/api/orders/2'));
      expect(chiaveDelFreno('/api/orders/1')).toBe('/api/orders/:id');
    });

    it('gli UUID diventano tutti la stessa chiave', () => {
      const a = '/api/orders/3f2504e0-4f89-41d3-9a0c-0305e82c3301/decide';
      const b = '/api/orders/8a1b2c3d-1111-2222-3333-444455556666/decide';
      expect(chiaveDelFreno(a)).toBe(chiaveDelFreno(b));
      expect(chiaveDelFreno(a)).toBe('/api/orders/:id/decide');
    });

    it('le stringhe esadecimali lunghe pure', () => {
      expect(chiaveDelFreno('/api/x/0123456789abcdef0123')).toBe('/api/x/:id');
    });

    it('due rotte diverse restano due chiavi diverse', () => {
      expect(chiaveDelFreno('/api/orders/1')).not.toBe(chiaveDelFreno('/api/returns/1'));
    });

    it('le parole normali non vengono scambiate per identificativi', () => {
      expect(chiaveDelFreno('/api/stripe/checkout')).toBe('/api/stripe/checkout');
      // «cod» e' esadecimale ma corta: non e' un identificativo.
      expect(chiaveDelFreno('/api/orders/cod')).toBe('/api/orders/cod');
    });
  });
});

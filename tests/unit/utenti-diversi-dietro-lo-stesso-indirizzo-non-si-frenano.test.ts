import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser,
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((_campo: string, id: string) => ({
          single: vi.fn(async () => ({ data: { id, role: 'buyer', is_approved: true } })),
        })),
      })),
    })),
  })),
}));

import { withAuth } from '@/lib/api/middleware';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/**
 * DUE PERSONE DIETRO LO STESSO INDIRIZZO NON SI FRENANO A VICENDA.
 *
 * 31/8/2026 (R003/R020, ricaduta) — Il 27 agosto il freno per indirizzo di
 * rete e' stato spostato dentro `authenticate()`, e la ragione era buona:
 * stava solo su tre involucri su sei. Ma spostandolo li' e' finito addosso
 * anche a chi si e' gia' identificato, e questo il freno per indirizzo non
 * l'ha mai dovuto fare.
 *
 * Il motivo sta scritto nel codice da prima, nel commento del freno per
 * utente: «due persone dietro lo stesso indirizzo — un ufficio, la rete di un
 * operatore mobile — non si penalizzano a vicenda». In Italia un solo indirizzo
 * IPv4 di un operatore mobile e' condiviso da centinaia di abbonati.
 *
 * Conseguenza per una persona vera: il lunedi' mattina, quattrocento clienti
 * che escono dalla stessa rete si tolgono il posto l'un l'altro, e a un certo
 * punto cento di loro leggono «troppe richieste» senza aver fatto niente.
 *
 * La regola giusta: il freno per indirizzo esiste per non pagare due chiamate
 * di rete a testa a chi bussa a vuoto. Quindi conta i TENTATIVI ANDATI A VUOTO,
 * non le persone. Chi entra davvero non consuma niente; chi bussa e viene
 * respinto riempie il secchio e, quando e' pieno, viene fermato prima di
 * costarci qualcosa.
 */

const TETTO_FALLIMENTI = 300;

/** Un solo indirizzo pubblico per tutti: e' la rete di un operatore mobile. */
const INDIRIZZO_CONDIVISO = '93.40.10.5';

function richiesta(percorso: string): NextRequest {
  return {
    headers: new Headers({ 'x-forwarded-for': INDIRIZZO_CONDIVISO }),
    nextUrl: { pathname: percorso },
    url: `http://localhost${percorso}`,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.EDGE_TRUST_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

describe('quattrocento clienti dietro lo stesso indirizzo', () => {
  it('IL CASO CHE ROMPEVA — nessuno di loro viene fermato per il traffico degli altri', async () => {
    const rotta = withAuth(async () => ({ status: 200 }) as never);

    // Quattrocento persone diverse, tutte entrate regolarmente, tutte dalla
    // stessa rete mobile. Nessuna malafede: e' il lunedi' mattina.
    const esiti: number[] = [];
    for (let i = 0; i < 400; i++) {
      getCurrentUser.mockResolvedValueOnce({ id: `cliente-${i}` });
      esiti.push((await rotta(richiesta('/api/orders'))).status);
    }

    const frenati = esiti.filter((s) => s === 429).length;
    expect(
      frenati,
      `${frenati} clienti paganti hanno letto «troppe richieste» per colpa del traffico di altri clienti sulla stessa rete`,
    ).toBe(0);
    expect(esiti.filter((s) => s === 200)).toHaveLength(400);
  });

  it('e chi entra davvero non consuma il secchio di chi bussa a vuoto', async () => {
    const rotta = withAuth(async () => ({ status: 200 }) as never);

    // Mille clienti veri passano per primi.
    for (let i = 0; i < 1000; i++) {
      getCurrentUser.mockResolvedValueOnce({ id: `cliente-${i}` });
      await rotta(richiesta('/api/prodotti'));
    }

    // Poi arriva uno che bussa a vuoto: deve trovare il secchio ancora intero.
    getCurrentUser.mockResolvedValue(null);
    expect((await rotta(richiesta('/api/prodotti'))).status).toBe(401);
  });
});

describe('il freno resta, e frena quello che deve', () => {
  it('una raffica di tentativi a vuoto dallo stesso indirizzo si ferma', async () => {
    const rotta = withAuth(async () => ({ status: 200 }) as never);
    getCurrentUser.mockResolvedValue(null);

    let ultima = 0;
    for (let i = 0; i <= TETTO_FALLIMENTI + 5; i++) {
      ultima = (await rotta(richiesta('/api/raffica'))).status;
    }
    expect(ultima, 'la raffica di tentativi a vuoto non incontra nessun freno').toBe(429);
  });

  it('e oltre il tetto smette di andare in rete: e per questo che il freno esiste', async () => {
    const rotta = withAuth(async () => ({ status: 200 }) as never);
    getCurrentUser.mockResolvedValue(null);

    for (let i = 0; i < TETTO_FALLIMENTI; i++) await rotta(richiesta('/api/costo'));
    const chiamatePrima = getCurrentUser.mock.calls.length;

    for (let i = 0; i < 20; i++) await rotta(richiesta('/api/costo'));

    expect(
      getCurrentUser.mock.calls.length,
      'risponde 429 ma va lo stesso a chiedere a Supabase: il costo lo paghiamo comunque',
    ).toBe(chiamatePrima);
  });

  it('e quando il secchio e pieno lo e per quella rotta, non per tutto il sito', async () => {
    const rotta = withAuth(async () => ({ status: 200 }) as never);
    getCurrentUser.mockResolvedValue(null);

    for (let i = 0; i <= TETTO_FALLIMENTI + 5; i++) await rotta(richiesta('/api/una'));

    getCurrentUser.mockResolvedValueOnce({ id: 'cliente-innocente' });
    expect((await rotta(richiesta('/api/altra'))).status).toBe(200);
  });
});

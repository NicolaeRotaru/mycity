import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 24/11/2026 — MODALITÀ DEMO (migrazione 709).
 *
 * Nicola: «Tutte le attività che si iscrivono però non hanno effettuato il loro pagamento entrano
 * sulla piattaforma in modalità demo e la loro vetrina non è visibile ancora sul marketplace».
 * La regola sta nel database e la prova vera è tests/sql/rls/modalita-demo-…test.sql. Qui:
 *  · il negozio in revisione apre il suo preventivo e paga (portiere e rotte), gli altri no;
 *  · il banner «Sei in modalità demo» dice il vero, e tace quando non sa;
 *  · nel codice nessuno decide la visibilità con un id scritto a mano.
 */

const stato = vi.hoisted(() => ({
  profilo: { id: 'u1', role: 'seller', is_approved: false } as Record<string, unknown>,
  approvalStatus: 'pending' as string | null,
  richiestaIl: '2026-11-24T10:00:00Z' as string | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'u1', email: 'negozio@esempio.it' })),
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn((colonne: string) => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: colonne.includes('approval_status') ? { approval_status: stato.approvalStatus, approval_requested_at: stato.richiestaIl } : stato.profilo,
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { decidiAccessoArea, PERCORSO_PREVENTIVO } from '@/lib/auth/decisione-portiere';
import { inModalitaDemo } from '@/lib/modalita-demo';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function richiesta(): NextRequest {
  return {
    headers: new Headers({ 'x-forwarded-for': '1.2.3.4' }),
    nextUrl: { pathname: '/api/seller/preventivo' },
    url: 'http://localhost/api/seller/preventivo',
    method: 'GET',
  } as unknown as NextRequest;
}

async function chiama() {
  const gestore = vi.fn(async () => new Response('ok', { status: 200 }) as never);
  const rotta = withSellerAnchePendingRateLimit({ name: 'prova-demo', max: 100, windowMs: 60_000 }, gestore);
  const r = await rotta(richiesta());
  return { status: r.status, chiamato: gestore.mock.calls.length > 0 };
}

beforeEach(() => {
  __resetRateLimitBuckets();
  delete process.env.UPSTASH_REDIS_REST_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  stato.profilo = { id: 'u1', role: 'seller', is_approved: false };
  stato.approvalStatus = 'pending';
  stato.richiestaIl = '2026-11-24T10:00:00Z';
});

describe('le rotte del preventivo e il negozio in revisione', () => {
  it('in attesa di approvazione: entra', async () => {
    expect(await chiama()).toEqual({ status: 200, chiamato: true });
  });

  it('approvato: entra; amministratore: entra', async () => {
    stato.profilo = { id: 'u1', role: 'seller', is_approved: true };
    expect((await chiama()).chiamato).toBe(true);
    stato.profilo = { id: 'u1', role: 'admin', is_approved: true };
    expect((await chiama()).chiamato).toBe(true);
  });

  it('rifiutato, sospeso o senza richiesta: resta fuori', async () => {
    for (const s of ['rejected', 'suspended', null]) {
      stato.approvalStatus = s;
      expect(await chiama(), String(s)).toEqual({ status: 403, chiamato: false });
    }
  });

  it('«pending» senza una richiesta mandata (un rifiutato che si riscrive lo stato da sé): resta fuori', async () => {
    stato.richiestaIl = null;
    expect(await chiama()).toEqual({ status: 403, chiamato: false });
  });

  it('un cliente o un fattorino: resta fuori, anche se «pending»', async () => {
    stato.profilo = { id: 'u1', role: 'buyer', is_approved: true };
    expect((await chiama()).chiamato).toBe(false);
    stato.profilo = { id: 'u1', role: 'rider', is_approved: false };
    expect((await chiama()).chiamato).toBe(false);
  });
});

describe('il portiere delle pagine', () => {
  const entra = (pathname: string, approved = false, role: 'seller' | 'buyer' = 'seller') =>
    decidiAccessoArea({ role, approved, allowed: ['seller', 'admin'], pathname }).azione === 'entra';

  it('il negozio non approvato entra nel preventivo e nelle pagine dei servizi', () => {
    expect(entra(PERCORSO_PREVENTIVO)).toBe(true);
    expect(entra(`${PERCORSO_PREVENTIVO}/social`)).toBe(true);
    expect(entra(`${PERCORSO_PREVENTIVO}/`)).toBe(true);
  });

  it('ma non nel resto del pannello, né in indirizzi che somigliano', () => {
    expect(entra('/seller/products')).toBe(false);
    expect(entra('/seller/orders')).toBe(false);
    expect(entra('/seller/preventivo-falso')).toBe(false);
    expect(entra(PERCORSO_PREVENTIVO, false, 'buyer')).toBe(false);
  });
});

describe('il banner «Sei in modalità demo»', () => {
  it('approvato e fuori vetrina: demo', () => {
    expect(inModalitaDemo({ approvato: true, inVetrina: false })).toBe(true);
  });
  it('in vetrina, non approvato, o risposta che non si sa: niente banner', () => {
    expect(inModalitaDemo({ approvato: true, inVetrina: true })).toBe(false);
    expect(inModalitaDemo({ approvato: false, inVetrina: false })).toBe(false);
    expect(inModalitaDemo({ approvato: true, inVetrina: null })).toBe(false);
    expect(inModalitaDemo({ approvato: true, inVetrina: undefined })).toBe(false);
  });
});

describe('la regola sta nel database, non in id scritti a mano', () => {
  const migrazione = readFileSync(path.resolve(__dirname, '../../migrations/709_i_negozi_nuovi_entrano_in_modalita_demo.sql'), 'utf8');
  it('la 709 non nomina Pane Quotidiano né altri negozi per id', () => {
    expect(migrazione).not.toMatch(/c0b240c0|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
